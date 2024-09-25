"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
var _runtime = _interopRequireDefault(require("regenerator-runtime/runtime"));
var _shelljs = _interopRequireDefault(require("shelljs"));
var _path = _interopRequireDefault(require("path"));
var _fs = _interopRequireDefault(require("fs"));
var _rimraf = _interopRequireDefault(require("rimraf"));
var _crossSpawn = _interopRequireDefault(require("cross-spawn"));
var _log = _interopRequireDefault(require("./log"));
var _defaultDependencies = _interopRequireDefault(require("./defaultDependencies"));
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
// eslint-disable-next-line no-unused-vars

/**
 * Promisfied rimraf.
 *
 * @param {string} dirPath - path to the dir to be deleted
 * @param {number} delay - delay the task by ms
 * @returns {Promise<any>}
 */
function removeDir(dirPath, delay = 0) {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      (0, _rimraf.default)(dirPath, {
        maxBusyTries: 100
      }, err => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    }, delay);
  });
}

/**
 * Wrapper for electron-builder.
 */
class InstallerBuilder {
  /**
   * @param {MeteorDesktop} $ - context
   *
   * @constructor
   */
  constructor($) {
    this.log = new _log.default('electronBuilder');
    this.$ = $;
    this.firstPass = true;
    this.lastRebuild = {};
    this.currentContext = null;
    this.installerDir = _path.default.join(this.$.env.options.output, this.$.env.paths.installerDir);
    this.platforms = [];
  }
  async init() {
    this.builder = await this.$.getDependency('electron-builder', _defaultDependencies.default['electron-builder']);
    const appBuilder = await this.$.getDependency('app-builder-lib', _defaultDependencies.default['electron-builder'], false);
    this.yarn = require(_path.default.join(appBuilder.path, 'out', 'util', 'yarn'));
    this.getGypEnv = this.yarn.getGypEnv;
    this.packageDependencies = require(_path.default.join(appBuilder.path, 'out', 'util', 'packageDependencies'));
  }

  /**
   * Prepares the last rebuild object for electron-builder.
   *
   * @param {string} arch
   * @param {string} platform
   * @returns {Object}
   */
  prepareLastRebuildObject(arch, platform = process.platform) {
    const productionDeps = this.packageDependencies.createLazyProductionDeps(this.$.env.paths.electronApp.root);
    this.lastRebuild = {
      frameworkInfo: {
        version: this.$.getElectronVersion(),
        useCustomDist: true
      },
      platform,
      arch,
      productionDeps
    };
    return this.lastRebuild;
  }

  /**
   * Calls npm rebuild from electron-builder.
   * @param {string} arch
   * @param {string} platform
   * @param {boolean} install
   * @returns {Promise}
   */
  async installOrRebuild(arch, platform = process.platform, install = false) {
    this.log.debug(`calling installOrRebuild from electron-builder for arch ${arch}`);
    this.prepareLastRebuildObject(arch, platform);
    await this.yarn.installOrRebuild(this.$.desktop.getSettings().builderOptions || {}, this.$.env.paths.electronApp.root, this.lastRebuild, install);
  }

  /**
   * Callback invoked before build is made. Ensures that app.asar have the right rebuilt
   * node_modules.
   *
   * @param {Object} context
   * @returns {Promise}
   */
  beforeBuild(context) {
    this.currentContext = Object.assign({}, context);
    return new Promise((resolve, reject) => {
      const platformMatches = process.platform === context.platform.nodeName;
      const rebuild = platformMatches && context.arch !== this.lastRebuild.arch;
      if (!platformMatches) {
        this.log.warn('skipping dependencies rebuild because platform is different, if you have native ' + 'node modules as your app dependencies you should od the build on the target platform only');
      }
      if (!rebuild) {
        this.moveNodeModulesOut().catch(e => reject(e)).then(() => setTimeout(() => resolve(false), 2000));
        // Timeout helps on Windows to clear the file locks.
      } else {
        // Lets rebuild the node_modules for different arch.
        this.installOrRebuild(context.arch, context.platform.nodeName).catch(e => reject(e)).then(() => this.$.electronApp.installLocalNodeModules(context.arch)).catch(e => reject(e)).then(() => {
          this.$.electronApp.scaffold.createAppRoot();
          this.$.electronApp.scaffold.copySkeletonApp();
          return this.$.electronApp.packSkeletonToAsar([this.$.env.paths.electronApp.meteorAsar, this.$.env.paths.electronApp.desktopAsar, this.$.env.paths.electronApp.extracted]);
        }).catch(e => reject(e)).then(() => this.moveNodeModulesOut()).catch(e => reject(e)).then(() => resolve(false));
      }
    });
  }

  /**
   * Callback to be invoked after packing. Restores node_modules to the .desktop-build.
   * @returns {Promise}
   */
  afterPack(context) {
    this.platforms = this.platforms.filter(platform => platform !== context.electronPlatformName);
    if (this.platforms.length !== 0) {
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      _shelljs.default.config.fatal = true;
      if (this.$.utils.exists(this.$.env.paths.electronApp.extractedNodeModules)) {
        this.log.debug('injecting extracted modules');
        _shelljs.default.cp('-Rf', this.$.env.paths.electronApp.extractedNodeModules, _path.default.join(this.getPackagedAppPath(context), 'node_modules'));
      }
      this.log.debug('moving node_modules back');
      // Move node_modules back.

      try {
        _shelljs.default.mv(this.$.env.paths.electronApp.tmpNodeModules, this.$.env.paths.electronApp.nodeModules);
      } catch (e) {
        reject(e);
        return;
      } finally {
        _shelljs.default.config.reset();
      }
      if (this.firstPass) {
        this.firstPass = false;
      }
      this.log.debug('node_modules moved back');
      this.wait().catch(e => reject(e)).then(() => resolve());
    });
  }

  /**
   * This command kills orphaned MSBuild.exe processes.
   * Sometime after native node_modules compilation they are still writing some logs,
   * prevent node_modules from being deleted.
   */
  killMSBuild() {
    if (this.currentContext.platform.nodeName !== 'win32') {
      return;
    }
    try {
      const out = _crossSpawn.default.sync('wmic', ['process', 'where', 'caption="MSBuild.exe"', 'get', 'processid']).stdout.toString('utf-8').split('\n');
      const regex = new RegExp(/(\d+)/, 'gm');
      // No we will check for those with the matching params.
      out.forEach(line => {
        const match = regex.exec(line) || false;
        if (match) {
          this.log.debug(`killing MSBuild.exe at pid: ${match[1]}`);
          _crossSpawn.default.sync('taskkill', ['/pid', match[1], '/f', '/t']);
        }
        regex.lastIndex = 0;
      });
    } catch (e) {
      this.log.debug('kill MSBuild failed');
    }
  }

  /**
   * Returns the path to packaged app.
   * @returns {string}
   */
  getPackagedAppPath(context = {}) {
    if (this.currentContext.platform.nodeName === 'darwin') {
      return _path.default.join(this.installerDir, 'mac', `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Resources', 'app');
    }
    const platformDir = `${this.currentContext.platform.nodeName === 'win32' ? 'win' : 'linux'}-${this.currentContext.arch === 'ia32' ? 'ia32-' : ''}unpacked`;
    return _path.default.join(this.installerDir, platformDir, 'resources', 'app');
  }

  /**
   * On Windows it waits for the app.asar in the packed app to be free (no file locks).
   * @returns {*}
   */
  wait() {
    if (this.currentContext.platform.nodeName !== 'win32') {
      return Promise.resolve();
    }
    const appAsarPath = _path.default.join(this.getPackagedAppPath(), 'app.asar');
    let retries = 0;
    const self = this;
    return new Promise((resolve, reject) => {
      function check() {
        _fs.default.open(appAsarPath, 'r+', (err, fd) => {
          retries += 1;
          if (err) {
            if (err.code !== 'ENOENT') {
              self.log.debug(`waiting for app.asar to be readable, ${'code' in err ? `currently reading it returns ${err.code}` : ''}`);
              if (retries < 6) {
                setTimeout(() => check(), 4000);
              } else {
                reject(`file is locked: ${appAsarPath}`);
              }
            } else {
              resolve();
            }
          } else {
            _fs.default.closeSync(fd);
            resolve();
          }
        });
      }
      check();
    });
  }

  /**
   * Prepares the target object passed to the electron-builder.
   *
   * @returns {Map<Platform, Map<Arch, Array<string>>>}
   */
  prepareTargets() {
    let arch = this.$.env.options.ia32 ? 'ia32' : 'x64';
    arch = this.$.env.options.allArchs ? 'all' : arch;
    const targets = [];
    if (this.$.env.options.win) {
      targets.push(this.builder.dependency.Platform.WINDOWS);
    }
    if (this.$.env.options.linux) {
      targets.push(this.builder.dependency.Platform.LINUX);
    }
    if (this.$.env.options.mac) {
      targets.push(this.builder.dependency.Platform.MAC);
    }
    if (targets.length === 0) {
      if (this.$.env.os.isWindows) {
        targets.push(this.builder.dependency.Platform.WINDOWS);
      } else if (this.$.env.os.isLinux) {
        targets.push(this.builder.dependency.Platform.LINUX);
      } else {
        targets.push(this.builder.dependency.Platform.MAC);
      }
    }
    return this.builder.dependency.createTargets(targets, null, arch);
  }
  async build() {
    const settings = this.$.desktop.getSettings();
    if (!('builderOptions' in settings)) {
      this.log.error('no builderOptions in settings.json, aborting');
      process.exit(1);
    }
    const builderOptions = Object.assign({}, settings.builderOptions);
    builderOptions.asar = false;
    builderOptions.npmRebuild = true;
    builderOptions.beforeBuild = this.beforeBuild.bind(this);
    builderOptions.afterPack = this.afterPack.bind(this);
    builderOptions.electronVersion = this.$.getElectronVersion();
    builderOptions.directories = {
      app: this.$.env.paths.electronApp.root,
      output: _path.default.join(this.$.env.options.output, this.$.env.paths.installerDir)
    };
    if ('mac' in builderOptions && 'target' in builderOptions.mac) {
      if (builderOptions.mac.target.includes('mas')) {
        this.platforms = ['darwin', 'mas'];
      }
    }
    try {
      this.log.debug('calling build from electron-builder');
      await this.builder.dependency.build(Object.assign({
        targets: this.prepareTargets(),
        config: builderOptions
      }, settings.builderCliOptions));
      if (this.$.utils.exists(this.$.env.paths.electronApp.extractedNodeModules)) {
        _shelljs.default.rm('-rf', this.$.env.paths.electronApp.extractedNodeModules);
      }
    } catch (e) {
      this.log.error('error while building installer: ', e);
    }
  }

  /**
   * Moves node_modules out of the app because while the app will be packaged
   * we do not want it to be there.
   * @returns {Promise<any>}
   */
  moveNodeModulesOut() {
    return new Promise((resolve, reject) => {
      this.log.debug('moving node_modules out, because we have them already in' + ' app.asar');
      this.killMSBuild();
      removeDir(this.$.env.paths.electronApp.tmpNodeModules).catch(e => reject(e)).then(() => {
        _shelljs.default.config.fatal = true;
        _shelljs.default.config.verbose = true;
        try {
          _shelljs.default.mv(this.$.env.paths.electronApp.nodeModules, this.$.env.paths.electronApp.tmpNodeModules);
          _shelljs.default.config.reset();
          return this.wait();
        } catch (e) {
          _shelljs.default.config.reset();
          return Promise.reject(e);
        }
      }).catch(e => reject(e)).then(() => removeDir(this.$.env.paths.electronApp.nodeModules, 1000)).catch(e => reject(e)).then(() => this.wait()).catch(reject).then(resolve);
    });
  }
}
exports.default = InstallerBuilder;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJfcnVudGltZSIsIl9pbnRlcm9wUmVxdWlyZURlZmF1bHQiLCJyZXF1aXJlIiwiX3NoZWxsanMiLCJfcGF0aCIsIl9mcyIsIl9yaW1yYWYiLCJfY3Jvc3NTcGF3biIsIl9sb2ciLCJfZGVmYXVsdERlcGVuZGVuY2llcyIsImUiLCJfX2VzTW9kdWxlIiwiZGVmYXVsdCIsInJlbW92ZURpciIsImRpclBhdGgiLCJkZWxheSIsIlByb21pc2UiLCJyZXNvbHZlIiwicmVqZWN0Iiwic2V0VGltZW91dCIsInJpbXJhZiIsIm1heEJ1c3lUcmllcyIsImVyciIsIkluc3RhbGxlckJ1aWxkZXIiLCJjb25zdHJ1Y3RvciIsIiQiLCJsb2ciLCJMb2ciLCJmaXJzdFBhc3MiLCJsYXN0UmVidWlsZCIsImN1cnJlbnRDb250ZXh0IiwiaW5zdGFsbGVyRGlyIiwicGF0aCIsImpvaW4iLCJlbnYiLCJvcHRpb25zIiwib3V0cHV0IiwicGF0aHMiLCJwbGF0Zm9ybXMiLCJpbml0IiwiYnVpbGRlciIsImdldERlcGVuZGVuY3kiLCJkZWZhdWx0RGVwZW5kZW5jaWVzIiwiYXBwQnVpbGRlciIsInlhcm4iLCJnZXRHeXBFbnYiLCJwYWNrYWdlRGVwZW5kZW5jaWVzIiwicHJlcGFyZUxhc3RSZWJ1aWxkT2JqZWN0IiwiYXJjaCIsInBsYXRmb3JtIiwicHJvY2VzcyIsInByb2R1Y3Rpb25EZXBzIiwiY3JlYXRlTGF6eVByb2R1Y3Rpb25EZXBzIiwiZWxlY3Ryb25BcHAiLCJyb290IiwiZnJhbWV3b3JrSW5mbyIsInZlcnNpb24iLCJnZXRFbGVjdHJvblZlcnNpb24iLCJ1c2VDdXN0b21EaXN0IiwiaW5zdGFsbE9yUmVidWlsZCIsImluc3RhbGwiLCJkZWJ1ZyIsImRlc2t0b3AiLCJnZXRTZXR0aW5ncyIsImJ1aWxkZXJPcHRpb25zIiwiYmVmb3JlQnVpbGQiLCJjb250ZXh0IiwiT2JqZWN0IiwiYXNzaWduIiwicGxhdGZvcm1NYXRjaGVzIiwibm9kZU5hbWUiLCJyZWJ1aWxkIiwid2FybiIsIm1vdmVOb2RlTW9kdWxlc091dCIsImNhdGNoIiwidGhlbiIsImluc3RhbGxMb2NhbE5vZGVNb2R1bGVzIiwic2NhZmZvbGQiLCJjcmVhdGVBcHBSb290IiwiY29weVNrZWxldG9uQXBwIiwicGFja1NrZWxldG9uVG9Bc2FyIiwibWV0ZW9yQXNhciIsImRlc2t0b3BBc2FyIiwiZXh0cmFjdGVkIiwiYWZ0ZXJQYWNrIiwiZmlsdGVyIiwiZWxlY3Ryb25QbGF0Zm9ybU5hbWUiLCJsZW5ndGgiLCJzaGVsbCIsImNvbmZpZyIsImZhdGFsIiwidXRpbHMiLCJleGlzdHMiLCJleHRyYWN0ZWROb2RlTW9kdWxlcyIsImNwIiwiZ2V0UGFja2FnZWRBcHBQYXRoIiwibXYiLCJ0bXBOb2RlTW9kdWxlcyIsIm5vZGVNb2R1bGVzIiwicmVzZXQiLCJ3YWl0Iiwia2lsbE1TQnVpbGQiLCJvdXQiLCJzcGF3biIsInN5bmMiLCJzdGRvdXQiLCJ0b1N0cmluZyIsInNwbGl0IiwicmVnZXgiLCJSZWdFeHAiLCJmb3JFYWNoIiwibGluZSIsIm1hdGNoIiwiZXhlYyIsImxhc3RJbmRleCIsInBhY2thZ2VyIiwiYXBwSW5mbyIsInByb2R1Y3RGaWxlbmFtZSIsInBsYXRmb3JtRGlyIiwiYXBwQXNhclBhdGgiLCJyZXRyaWVzIiwic2VsZiIsImNoZWNrIiwiZnMiLCJvcGVuIiwiZmQiLCJjb2RlIiwiY2xvc2VTeW5jIiwicHJlcGFyZVRhcmdldHMiLCJpYTMyIiwiYWxsQXJjaHMiLCJ0YXJnZXRzIiwid2luIiwicHVzaCIsImRlcGVuZGVuY3kiLCJQbGF0Zm9ybSIsIldJTkRPV1MiLCJsaW51eCIsIkxJTlVYIiwibWFjIiwiTUFDIiwib3MiLCJpc1dpbmRvd3MiLCJpc0xpbnV4IiwiY3JlYXRlVGFyZ2V0cyIsImJ1aWxkIiwic2V0dGluZ3MiLCJlcnJvciIsImV4aXQiLCJhc2FyIiwibnBtUmVidWlsZCIsImJpbmQiLCJlbGVjdHJvblZlcnNpb24iLCJkaXJlY3RvcmllcyIsImFwcCIsInRhcmdldCIsImluY2x1ZGVzIiwiYnVpbGRlckNsaU9wdGlvbnMiLCJybSIsInZlcmJvc2UiLCJleHBvcnRzIl0sInNvdXJjZXMiOlsiLi4vbGliL2VsZWN0cm9uQnVpbGRlci5qcyJdLCJzb3VyY2VzQ29udGVudCI6WyIvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgbm8tdW51c2VkLXZhcnNcbmltcG9ydCByZWdlbmVyYXRvclJ1bnRpbWUgZnJvbSAncmVnZW5lcmF0b3ItcnVudGltZS9ydW50aW1lJztcbmltcG9ydCBzaGVsbCBmcm9tICdzaGVsbGpzJztcbmltcG9ydCBwYXRoIGZyb20gJ3BhdGgnO1xuaW1wb3J0IGZzIGZyb20gJ2ZzJztcbmltcG9ydCByaW1yYWYgZnJvbSAncmltcmFmJztcbmltcG9ydCBzcGF3biBmcm9tICdjcm9zcy1zcGF3bic7XG5pbXBvcnQgTG9nIGZyb20gJy4vbG9nJztcbmltcG9ydCBkZWZhdWx0RGVwZW5kZW5jaWVzIGZyb20gJy4vZGVmYXVsdERlcGVuZGVuY2llcyc7XG5cbi8qKlxuICogUHJvbWlzZmllZCByaW1yYWYuXG4gKlxuICogQHBhcmFtIHtzdHJpbmd9IGRpclBhdGggLSBwYXRoIHRvIHRoZSBkaXIgdG8gYmUgZGVsZXRlZFxuICogQHBhcmFtIHtudW1iZXJ9IGRlbGF5IC0gZGVsYXkgdGhlIHRhc2sgYnkgbXNcbiAqIEByZXR1cm5zIHtQcm9taXNlPGFueT59XG4gKi9cbmZ1bmN0aW9uIHJlbW92ZURpcihkaXJQYXRoLCBkZWxheSA9IDApIHtcbiAgICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgICAgICBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgICAgICAgIHJpbXJhZihkaXJQYXRoLCB7XG4gICAgICAgICAgICAgICAgbWF4QnVzeVRyaWVzOiAxMDBcbiAgICAgICAgICAgIH0sIChlcnIpID0+IHtcbiAgICAgICAgICAgICAgICBpZiAoZXJyKSB7XG4gICAgICAgICAgICAgICAgICAgIHJlamVjdChlcnIpO1xuICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgIHJlc29sdmUoKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfSwgZGVsYXkpO1xuICAgIH0pO1xufVxuXG4vKipcbiAqIFdyYXBwZXIgZm9yIGVsZWN0cm9uLWJ1aWxkZXIuXG4gKi9cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIEluc3RhbGxlckJ1aWxkZXIge1xuICAgIC8qKlxuICAgICAqIEBwYXJhbSB7TWV0ZW9yRGVza3RvcH0gJCAtIGNvbnRleHRcbiAgICAgKlxuICAgICAqIEBjb25zdHJ1Y3RvclxuICAgICAqL1xuICAgIGNvbnN0cnVjdG9yKCQpIHtcbiAgICAgICAgdGhpcy5sb2cgPSBuZXcgTG9nKCdlbGVjdHJvbkJ1aWxkZXInKTtcbiAgICAgICAgdGhpcy4kID0gJDtcbiAgICAgICAgdGhpcy5maXJzdFBhc3MgPSB0cnVlO1xuICAgICAgICB0aGlzLmxhc3RSZWJ1aWxkID0ge307XG4gICAgICAgIHRoaXMuY3VycmVudENvbnRleHQgPSBudWxsO1xuICAgICAgICB0aGlzLmluc3RhbGxlckRpciA9IHBhdGguam9pbih0aGlzLiQuZW52Lm9wdGlvbnMub3V0cHV0LCB0aGlzLiQuZW52LnBhdGhzLmluc3RhbGxlckRpcik7XG4gICAgICAgIHRoaXMucGxhdGZvcm1zID0gW107XG4gICAgfVxuXG4gICAgYXN5bmMgaW5pdCgpIHtcbiAgICAgICAgdGhpcy5idWlsZGVyID0gYXdhaXQgdGhpcy4kLmdldERlcGVuZGVuY3koJ2VsZWN0cm9uLWJ1aWxkZXInLCBkZWZhdWx0RGVwZW5kZW5jaWVzWydlbGVjdHJvbi1idWlsZGVyJ10pO1xuICAgICAgICBjb25zdCBhcHBCdWlsZGVyID0gYXdhaXQgdGhpcy4kLmdldERlcGVuZGVuY3koJ2FwcC1idWlsZGVyLWxpYicsIGRlZmF1bHREZXBlbmRlbmNpZXNbJ2VsZWN0cm9uLWJ1aWxkZXInXSwgZmFsc2UpO1xuXG4gICAgICAgIHRoaXMueWFybiA9IHJlcXVpcmUocGF0aC5qb2luKGFwcEJ1aWxkZXIucGF0aCwgJ291dCcsICd1dGlsJywgJ3lhcm4nKSk7XG4gICAgICAgIHRoaXMuZ2V0R3lwRW52ID0gdGhpcy55YXJuLmdldEd5cEVudjtcbiAgICAgICAgdGhpcy5wYWNrYWdlRGVwZW5kZW5jaWVzID0gcmVxdWlyZShwYXRoLmpvaW4oYXBwQnVpbGRlci5wYXRoLCAnb3V0JywgJ3V0aWwnLCAncGFja2FnZURlcGVuZGVuY2llcycpKTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBQcmVwYXJlcyB0aGUgbGFzdCByZWJ1aWxkIG9iamVjdCBmb3IgZWxlY3Ryb24tYnVpbGRlci5cbiAgICAgKlxuICAgICAqIEBwYXJhbSB7c3RyaW5nfSBhcmNoXG4gICAgICogQHBhcmFtIHtzdHJpbmd9IHBsYXRmb3JtXG4gICAgICogQHJldHVybnMge09iamVjdH1cbiAgICAgKi9cbiAgICBwcmVwYXJlTGFzdFJlYnVpbGRPYmplY3QoYXJjaCwgcGxhdGZvcm0gPSBwcm9jZXNzLnBsYXRmb3JtKSB7XG4gICAgICAgIGNvbnN0IHByb2R1Y3Rpb25EZXBzID0gdGhpcy5wYWNrYWdlRGVwZW5kZW5jaWVzXG4gICAgICAgICAgICAuY3JlYXRlTGF6eVByb2R1Y3Rpb25EZXBzKHRoaXMuJC5lbnYucGF0aHMuZWxlY3Ryb25BcHAucm9vdCk7XG4gICAgICAgIHRoaXMubGFzdFJlYnVpbGQgPSB7XG4gICAgICAgICAgICBmcmFtZXdvcmtJbmZvOiB7IHZlcnNpb246IHRoaXMuJC5nZXRFbGVjdHJvblZlcnNpb24oKSwgdXNlQ3VzdG9tRGlzdDogdHJ1ZSB9LFxuICAgICAgICAgICAgcGxhdGZvcm0sXG4gICAgICAgICAgICBhcmNoLFxuICAgICAgICAgICAgcHJvZHVjdGlvbkRlcHNcbiAgICAgICAgfTtcbiAgICAgICAgcmV0dXJuIHRoaXMubGFzdFJlYnVpbGQ7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogQ2FsbHMgbnBtIHJlYnVpbGQgZnJvbSBlbGVjdHJvbi1idWlsZGVyLlxuICAgICAqIEBwYXJhbSB7c3RyaW5nfSBhcmNoXG4gICAgICogQHBhcmFtIHtzdHJpbmd9IHBsYXRmb3JtXG4gICAgICogQHBhcmFtIHtib29sZWFufSBpbnN0YWxsXG4gICAgICogQHJldHVybnMge1Byb21pc2V9XG4gICAgICovXG4gICAgYXN5bmMgaW5zdGFsbE9yUmVidWlsZChhcmNoLCBwbGF0Zm9ybSA9IHByb2Nlc3MucGxhdGZvcm0sIGluc3RhbGwgPSBmYWxzZSkge1xuICAgICAgICB0aGlzLmxvZy5kZWJ1ZyhgY2FsbGluZyBpbnN0YWxsT3JSZWJ1aWxkIGZyb20gZWxlY3Ryb24tYnVpbGRlciBmb3IgYXJjaCAke2FyY2h9YCk7XG4gICAgICAgIHRoaXMucHJlcGFyZUxhc3RSZWJ1aWxkT2JqZWN0KGFyY2gsIHBsYXRmb3JtKTtcbiAgICAgICAgYXdhaXQgdGhpcy55YXJuLmluc3RhbGxPclJlYnVpbGQodGhpcy4kLmRlc2t0b3AuZ2V0U2V0dGluZ3MoKS5idWlsZGVyT3B0aW9ucyB8fCB7fSxcbiAgICAgICAgICAgIHRoaXMuJC5lbnYucGF0aHMuZWxlY3Ryb25BcHAucm9vdCwgdGhpcy5sYXN0UmVidWlsZCwgaW5zdGFsbCk7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogQ2FsbGJhY2sgaW52b2tlZCBiZWZvcmUgYnVpbGQgaXMgbWFkZS4gRW5zdXJlcyB0aGF0IGFwcC5hc2FyIGhhdmUgdGhlIHJpZ2h0IHJlYnVpbHRcbiAgICAgKiBub2RlX21vZHVsZXMuXG4gICAgICpcbiAgICAgKiBAcGFyYW0ge09iamVjdH0gY29udGV4dFxuICAgICAqIEByZXR1cm5zIHtQcm9taXNlfVxuICAgICAqL1xuICAgIGJlZm9yZUJ1aWxkKGNvbnRleHQpIHtcbiAgICAgICAgdGhpcy5jdXJyZW50Q29udGV4dCA9IE9iamVjdC5hc3NpZ24oe30sIGNvbnRleHQpO1xuICAgICAgICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgICAgICAgICAgY29uc3QgcGxhdGZvcm1NYXRjaGVzID0gcHJvY2Vzcy5wbGF0Zm9ybSA9PT0gY29udGV4dC5wbGF0Zm9ybS5ub2RlTmFtZTtcbiAgICAgICAgICAgIGNvbnN0IHJlYnVpbGQgPSBwbGF0Zm9ybU1hdGNoZXMgJiYgY29udGV4dC5hcmNoICE9PSB0aGlzLmxhc3RSZWJ1aWxkLmFyY2g7XG4gICAgICAgICAgICBpZiAoIXBsYXRmb3JtTWF0Y2hlcykge1xuICAgICAgICAgICAgICAgIHRoaXMubG9nLndhcm4oJ3NraXBwaW5nIGRlcGVuZGVuY2llcyByZWJ1aWxkIGJlY2F1c2UgcGxhdGZvcm0gaXMgZGlmZmVyZW50LCBpZiB5b3UgaGF2ZSBuYXRpdmUgJyArXG4gICAgICAgICAgICAgICAgICAgICdub2RlIG1vZHVsZXMgYXMgeW91ciBhcHAgZGVwZW5kZW5jaWVzIHlvdSBzaG91bGQgb2QgdGhlIGJ1aWxkIG9uIHRoZSB0YXJnZXQgcGxhdGZvcm0gb25seScpO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpZiAoIXJlYnVpbGQpIHtcbiAgICAgICAgICAgICAgICB0aGlzLm1vdmVOb2RlTW9kdWxlc091dCgpXG4gICAgICAgICAgICAgICAgICAgIC5jYXRjaChlID0+IHJlamVjdChlKSlcbiAgICAgICAgICAgICAgICAgICAgLnRoZW4oKCkgPT4gc2V0VGltZW91dCgoKSA9PiByZXNvbHZlKGZhbHNlKSwgMjAwMCkpO1xuICAgICAgICAgICAgICAgIC8vIFRpbWVvdXQgaGVscHMgb24gV2luZG93cyB0byBjbGVhciB0aGUgZmlsZSBsb2Nrcy5cbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgLy8gTGV0cyByZWJ1aWxkIHRoZSBub2RlX21vZHVsZXMgZm9yIGRpZmZlcmVudCBhcmNoLlxuICAgICAgICAgICAgICAgIHRoaXMuaW5zdGFsbE9yUmVidWlsZChjb250ZXh0LmFyY2gsIGNvbnRleHQucGxhdGZvcm0ubm9kZU5hbWUpXG4gICAgICAgICAgICAgICAgICAgIC5jYXRjaChlID0+IHJlamVjdChlKSlcbiAgICAgICAgICAgICAgICAgICAgLnRoZW4oKCkgPT4gdGhpcy4kLmVsZWN0cm9uQXBwLmluc3RhbGxMb2NhbE5vZGVNb2R1bGVzKGNvbnRleHQuYXJjaCkpXG4gICAgICAgICAgICAgICAgICAgIC5jYXRjaChlID0+IHJlamVjdChlKSlcbiAgICAgICAgICAgICAgICAgICAgLnRoZW4oKCkgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy4kLmVsZWN0cm9uQXBwLnNjYWZmb2xkLmNyZWF0ZUFwcFJvb3QoKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuJC5lbGVjdHJvbkFwcC5zY2FmZm9sZC5jb3B5U2tlbGV0b25BcHAoKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiB0aGlzLiQuZWxlY3Ryb25BcHAucGFja1NrZWxldG9uVG9Bc2FyKFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIFtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy4kLmVudi5wYXRocy5lbGVjdHJvbkFwcC5tZXRlb3JBc2FyLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aGlzLiQuZW52LnBhdGhzLmVsZWN0cm9uQXBwLmRlc2t0b3BBc2FyLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aGlzLiQuZW52LnBhdGhzLmVsZWN0cm9uQXBwLmV4dHJhY3RlZFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIF1cbiAgICAgICAgICAgICAgICAgICAgICAgICk7XG4gICAgICAgICAgICAgICAgICAgIH0pXG4gICAgICAgICAgICAgICAgICAgIC5jYXRjaChlID0+IHJlamVjdChlKSlcbiAgICAgICAgICAgICAgICAgICAgLnRoZW4oKCkgPT4gdGhpcy5tb3ZlTm9kZU1vZHVsZXNPdXQoKSlcbiAgICAgICAgICAgICAgICAgICAgLmNhdGNoKGUgPT4gcmVqZWN0KGUpKVxuICAgICAgICAgICAgICAgICAgICAudGhlbigoKSA9PiByZXNvbHZlKGZhbHNlKSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIENhbGxiYWNrIHRvIGJlIGludm9rZWQgYWZ0ZXIgcGFja2luZy4gUmVzdG9yZXMgbm9kZV9tb2R1bGVzIHRvIHRoZSAuZGVza3RvcC1idWlsZC5cbiAgICAgKiBAcmV0dXJucyB7UHJvbWlzZX1cbiAgICAgKi9cbiAgICBhZnRlclBhY2soY29udGV4dCkge1xuICAgICAgICB0aGlzLnBsYXRmb3JtcyA9IHRoaXMucGxhdGZvcm1zXG4gICAgICAgICAgICAuZmlsdGVyKHBsYXRmb3JtID0+IHBsYXRmb3JtICE9PSBjb250ZXh0LmVsZWN0cm9uUGxhdGZvcm1OYW1lKTtcbiAgICAgICAgaWYgKHRoaXMucGxhdGZvcm1zLmxlbmd0aCAhPT0gMCkge1xuICAgICAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICAgICAgICBzaGVsbC5jb25maWcuZmF0YWwgPSB0cnVlO1xuXG4gICAgICAgICAgICBpZiAodGhpcy4kLnV0aWxzLmV4aXN0cyh0aGlzLiQuZW52LnBhdGhzLmVsZWN0cm9uQXBwLmV4dHJhY3RlZE5vZGVNb2R1bGVzKSkge1xuICAgICAgICAgICAgICAgIHRoaXMubG9nLmRlYnVnKCdpbmplY3RpbmcgZXh0cmFjdGVkIG1vZHVsZXMnKTtcbiAgICAgICAgICAgICAgICBzaGVsbC5jcChcbiAgICAgICAgICAgICAgICAgICAgJy1SZicsXG4gICAgICAgICAgICAgICAgICAgIHRoaXMuJC5lbnYucGF0aHMuZWxlY3Ryb25BcHAuZXh0cmFjdGVkTm9kZU1vZHVsZXMsXG4gICAgICAgICAgICAgICAgICAgIHBhdGguam9pbih0aGlzLmdldFBhY2thZ2VkQXBwUGF0aChjb250ZXh0KSwgJ25vZGVfbW9kdWxlcycpXG4gICAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgdGhpcy5sb2cuZGVidWcoJ21vdmluZyBub2RlX21vZHVsZXMgYmFjaycpO1xuICAgICAgICAgICAgLy8gTW92ZSBub2RlX21vZHVsZXMgYmFjay5cblxuICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICBzaGVsbC5tdihcbiAgICAgICAgICAgICAgICAgICAgdGhpcy4kLmVudi5wYXRocy5lbGVjdHJvbkFwcC50bXBOb2RlTW9kdWxlcyxcbiAgICAgICAgICAgICAgICAgICAgdGhpcy4kLmVudi5wYXRocy5lbGVjdHJvbkFwcC5ub2RlTW9kdWxlc1xuICAgICAgICAgICAgICAgICk7XG4gICAgICAgICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgICAgICAgICAgcmVqZWN0KGUpO1xuICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgIH0gZmluYWxseSB7XG4gICAgICAgICAgICAgICAgc2hlbGwuY29uZmlnLnJlc2V0KCk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGlmICh0aGlzLmZpcnN0UGFzcykge1xuICAgICAgICAgICAgICAgIHRoaXMuZmlyc3RQYXNzID0gZmFsc2U7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICB0aGlzLmxvZy5kZWJ1Zygnbm9kZV9tb2R1bGVzIG1vdmVkIGJhY2snKTtcblxuICAgICAgICAgICAgdGhpcy53YWl0KClcbiAgICAgICAgICAgICAgICAuY2F0Y2goZSA9PiByZWplY3QoZSkpXG4gICAgICAgICAgICAgICAgLnRoZW4oKCkgPT4gcmVzb2x2ZSgpKTtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogVGhpcyBjb21tYW5kIGtpbGxzIG9ycGhhbmVkIE1TQnVpbGQuZXhlIHByb2Nlc3Nlcy5cbiAgICAgKiBTb21ldGltZSBhZnRlciBuYXRpdmUgbm9kZV9tb2R1bGVzIGNvbXBpbGF0aW9uIHRoZXkgYXJlIHN0aWxsIHdyaXRpbmcgc29tZSBsb2dzLFxuICAgICAqIHByZXZlbnQgbm9kZV9tb2R1bGVzIGZyb20gYmVpbmcgZGVsZXRlZC5cbiAgICAgKi9cbiAgICBraWxsTVNCdWlsZCgpIHtcbiAgICAgICAgaWYgKHRoaXMuY3VycmVudENvbnRleHQucGxhdGZvcm0ubm9kZU5hbWUgIT09ICd3aW4zMicpIHtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICB0cnkge1xuICAgICAgICAgICAgY29uc3Qgb3V0ID0gc3Bhd25cbiAgICAgICAgICAgICAgICAuc3luYyhcbiAgICAgICAgICAgICAgICAgICAgJ3dtaWMnLFxuICAgICAgICAgICAgICAgICAgICBbJ3Byb2Nlc3MnLCAnd2hlcmUnLCAnY2FwdGlvbj1cIk1TQnVpbGQuZXhlXCInLCAnZ2V0JywgJ3Byb2Nlc3NpZCddXG4gICAgICAgICAgICAgICAgKVxuICAgICAgICAgICAgICAgIC5zdGRvdXQudG9TdHJpbmcoJ3V0Zi04JylcbiAgICAgICAgICAgICAgICAuc3BsaXQoJ1xcbicpO1xuXG4gICAgICAgICAgICBjb25zdCByZWdleCA9IG5ldyBSZWdFeHAoLyhcXGQrKS8sICdnbScpO1xuICAgICAgICAgICAgLy8gTm8gd2Ugd2lsbCBjaGVjayBmb3IgdGhvc2Ugd2l0aCB0aGUgbWF0Y2hpbmcgcGFyYW1zLlxuICAgICAgICAgICAgb3V0LmZvckVhY2goKGxpbmUpID0+IHtcbiAgICAgICAgICAgICAgICBjb25zdCBtYXRjaCA9IHJlZ2V4LmV4ZWMobGluZSkgfHwgZmFsc2U7XG4gICAgICAgICAgICAgICAgaWYgKG1hdGNoKSB7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMubG9nLmRlYnVnKGBraWxsaW5nIE1TQnVpbGQuZXhlIGF0IHBpZDogJHttYXRjaFsxXX1gKTtcbiAgICAgICAgICAgICAgICAgICAgc3Bhd24uc3luYygndGFza2tpbGwnLCBbJy9waWQnLCBtYXRjaFsxXSwgJy9mJywgJy90J10pO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICByZWdleC5sYXN0SW5kZXggPSAwO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgICAgIHRoaXMubG9nLmRlYnVnKCdraWxsIE1TQnVpbGQgZmFpbGVkJyk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBSZXR1cm5zIHRoZSBwYXRoIHRvIHBhY2thZ2VkIGFwcC5cbiAgICAgKiBAcmV0dXJucyB7c3RyaW5nfVxuICAgICAqL1xuICAgIGdldFBhY2thZ2VkQXBwUGF0aChjb250ZXh0ID0ge30pIHtcbiAgICAgICAgaWYgKHRoaXMuY3VycmVudENvbnRleHQucGxhdGZvcm0ubm9kZU5hbWUgPT09ICdkYXJ3aW4nKSB7XG4gICAgICAgICAgICByZXR1cm4gcGF0aC5qb2luKFxuICAgICAgICAgICAgICAgIHRoaXMuaW5zdGFsbGVyRGlyLFxuICAgICAgICAgICAgICAgICdtYWMnLFxuICAgICAgICAgICAgICAgIGAke2NvbnRleHQucGFja2FnZXIuYXBwSW5mby5wcm9kdWN0RmlsZW5hbWV9LmFwcGAsXG4gICAgICAgICAgICAgICAgJ0NvbnRlbnRzJywgJ1Jlc291cmNlcycsICdhcHAnXG4gICAgICAgICAgICApO1xuICAgICAgICB9XG4gICAgICAgIGNvbnN0IHBsYXRmb3JtRGlyID1cbiAgICAgICAgICAgIGAke3RoaXMuY3VycmVudENvbnRleHQucGxhdGZvcm0ubm9kZU5hbWUgPT09ICd3aW4zMicgPyAnd2luJyA6ICdsaW51eCd9LSR7dGhpcy5jdXJyZW50Q29udGV4dC5hcmNoID09PSAnaWEzMicgPyAnaWEzMi0nIDogJyd9dW5wYWNrZWRgO1xuICAgICAgICByZXR1cm4gcGF0aC5qb2luKFxuICAgICAgICAgICAgdGhpcy5pbnN0YWxsZXJEaXIsXG4gICAgICAgICAgICBwbGF0Zm9ybURpcixcbiAgICAgICAgICAgICdyZXNvdXJjZXMnLCAnYXBwJ1xuICAgICAgICApO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIE9uIFdpbmRvd3MgaXQgd2FpdHMgZm9yIHRoZSBhcHAuYXNhciBpbiB0aGUgcGFja2VkIGFwcCB0byBiZSBmcmVlIChubyBmaWxlIGxvY2tzKS5cbiAgICAgKiBAcmV0dXJucyB7Kn1cbiAgICAgKi9cbiAgICB3YWl0KCkge1xuICAgICAgICBpZiAodGhpcy5jdXJyZW50Q29udGV4dC5wbGF0Zm9ybS5ub2RlTmFtZSAhPT0gJ3dpbjMyJykge1xuICAgICAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpO1xuICAgICAgICB9XG4gICAgICAgIGNvbnN0IGFwcEFzYXJQYXRoID0gcGF0aC5qb2luKFxuICAgICAgICAgICAgdGhpcy5nZXRQYWNrYWdlZEFwcFBhdGgoKSxcbiAgICAgICAgICAgICdhcHAuYXNhcidcbiAgICAgICAgKTtcbiAgICAgICAgbGV0IHJldHJpZXMgPSAwO1xuICAgICAgICBjb25zdCBzZWxmID0gdGhpcztcbiAgICAgICAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgICAgICAgIGZ1bmN0aW9uIGNoZWNrKCkge1xuICAgICAgICAgICAgICAgIGZzLm9wZW4oYXBwQXNhclBhdGgsICdyKycsIChlcnIsIGZkKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgIHJldHJpZXMgKz0gMTtcbiAgICAgICAgICAgICAgICAgICAgaWYgKGVycikge1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGVyci5jb2RlICE9PSAnRU5PRU5UJykge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHNlbGYubG9nLmRlYnVnKGB3YWl0aW5nIGZvciBhcHAuYXNhciB0byBiZSByZWFkYWJsZSwgJHsnY29kZScgaW4gZXJyID8gYGN1cnJlbnRseSByZWFkaW5nIGl0IHJldHVybnMgJHtlcnIuY29kZX1gIDogJyd9YCk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHJldHJpZXMgPCA2KSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHNldFRpbWVvdXQoKCkgPT4gY2hlY2soKSwgNDAwMCk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcmVqZWN0KGBmaWxlIGlzIGxvY2tlZDogJHthcHBBc2FyUGF0aH1gKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJlc29sdmUoKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGZzLmNsb3NlU3luYyhmZCk7XG4gICAgICAgICAgICAgICAgICAgICAgICByZXNvbHZlKCk7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGNoZWNrKCk7XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIFByZXBhcmVzIHRoZSB0YXJnZXQgb2JqZWN0IHBhc3NlZCB0byB0aGUgZWxlY3Ryb24tYnVpbGRlci5cbiAgICAgKlxuICAgICAqIEByZXR1cm5zIHtNYXA8UGxhdGZvcm0sIE1hcDxBcmNoLCBBcnJheTxzdHJpbmc+Pj59XG4gICAgICovXG4gICAgcHJlcGFyZVRhcmdldHMoKSB7XG4gICAgICAgIGxldCBhcmNoID0gdGhpcy4kLmVudi5vcHRpb25zLmlhMzIgPyAnaWEzMicgOiAneDY0JztcbiAgICAgICAgYXJjaCA9IHRoaXMuJC5lbnYub3B0aW9ucy5hbGxBcmNocyA/ICdhbGwnIDogYXJjaDtcblxuICAgICAgICBjb25zdCB0YXJnZXRzID0gW107XG5cbiAgICAgICAgaWYgKHRoaXMuJC5lbnYub3B0aW9ucy53aW4pIHtcbiAgICAgICAgICAgIHRhcmdldHMucHVzaCh0aGlzLmJ1aWxkZXIuZGVwZW5kZW5jeS5QbGF0Zm9ybS5XSU5ET1dTKTtcbiAgICAgICAgfVxuICAgICAgICBpZiAodGhpcy4kLmVudi5vcHRpb25zLmxpbnV4KSB7XG4gICAgICAgICAgICB0YXJnZXRzLnB1c2godGhpcy5idWlsZGVyLmRlcGVuZGVuY3kuUGxhdGZvcm0uTElOVVgpO1xuICAgICAgICB9XG4gICAgICAgIGlmICh0aGlzLiQuZW52Lm9wdGlvbnMubWFjKSB7XG4gICAgICAgICAgICB0YXJnZXRzLnB1c2godGhpcy5idWlsZGVyLmRlcGVuZGVuY3kuUGxhdGZvcm0uTUFDKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmICh0YXJnZXRzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICAgICAgaWYgKHRoaXMuJC5lbnYub3MuaXNXaW5kb3dzKSB7XG4gICAgICAgICAgICAgICAgdGFyZ2V0cy5wdXNoKHRoaXMuYnVpbGRlci5kZXBlbmRlbmN5LlBsYXRmb3JtLldJTkRPV1MpO1xuICAgICAgICAgICAgfSBlbHNlIGlmICh0aGlzLiQuZW52Lm9zLmlzTGludXgpIHtcbiAgICAgICAgICAgICAgICB0YXJnZXRzLnB1c2godGhpcy5idWlsZGVyLmRlcGVuZGVuY3kuUGxhdGZvcm0uTElOVVgpO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICB0YXJnZXRzLnB1c2godGhpcy5idWlsZGVyLmRlcGVuZGVuY3kuUGxhdGZvcm0uTUFDKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gdGhpcy5idWlsZGVyLmRlcGVuZGVuY3kuY3JlYXRlVGFyZ2V0cyh0YXJnZXRzLCBudWxsLCBhcmNoKTtcbiAgICB9XG5cbiAgICBhc3luYyBidWlsZCgpIHtcbiAgICAgICAgY29uc3Qgc2V0dGluZ3MgPSB0aGlzLiQuZGVza3RvcC5nZXRTZXR0aW5ncygpO1xuICAgICAgICBpZiAoISgnYnVpbGRlck9wdGlvbnMnIGluIHNldHRpbmdzKSkge1xuICAgICAgICAgICAgdGhpcy5sb2cuZXJyb3IoXG4gICAgICAgICAgICAgICAgJ25vIGJ1aWxkZXJPcHRpb25zIGluIHNldHRpbmdzLmpzb24sIGFib3J0aW5nJ1xuICAgICAgICAgICAgKTtcbiAgICAgICAgICAgIHByb2Nlc3MuZXhpdCgxKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IGJ1aWxkZXJPcHRpb25zID0gT2JqZWN0LmFzc2lnbih7fSwgc2V0dGluZ3MuYnVpbGRlck9wdGlvbnMpO1xuXG4gICAgICAgIGJ1aWxkZXJPcHRpb25zLmFzYXIgPSBmYWxzZTtcbiAgICAgICAgYnVpbGRlck9wdGlvbnMubnBtUmVidWlsZCA9IHRydWU7XG5cbiAgICAgICAgYnVpbGRlck9wdGlvbnMuYmVmb3JlQnVpbGQgPSB0aGlzLmJlZm9yZUJ1aWxkLmJpbmQodGhpcyk7XG4gICAgICAgIGJ1aWxkZXJPcHRpb25zLmFmdGVyUGFjayA9IHRoaXMuYWZ0ZXJQYWNrLmJpbmQodGhpcyk7XG4gICAgICAgIGJ1aWxkZXJPcHRpb25zLmVsZWN0cm9uVmVyc2lvbiA9IHRoaXMuJC5nZXRFbGVjdHJvblZlcnNpb24oKTtcblxuICAgICAgICBidWlsZGVyT3B0aW9ucy5kaXJlY3RvcmllcyA9IHtcbiAgICAgICAgICAgIGFwcDogdGhpcy4kLmVudi5wYXRocy5lbGVjdHJvbkFwcC5yb290LFxuICAgICAgICAgICAgb3V0cHV0OiBwYXRoLmpvaW4odGhpcy4kLmVudi5vcHRpb25zLm91dHB1dCwgdGhpcy4kLmVudi5wYXRocy5pbnN0YWxsZXJEaXIpXG4gICAgICAgIH07XG5cbiAgICAgICAgaWYgKCdtYWMnIGluIGJ1aWxkZXJPcHRpb25zICYmICd0YXJnZXQnIGluIGJ1aWxkZXJPcHRpb25zLm1hYykge1xuICAgICAgICAgICAgaWYgKGJ1aWxkZXJPcHRpb25zLm1hYy50YXJnZXQuaW5jbHVkZXMoJ21hcycpKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5wbGF0Zm9ybXMgPSBbJ2RhcndpbicsICdtYXMnXTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICB0aGlzLmxvZy5kZWJ1ZygnY2FsbGluZyBidWlsZCBmcm9tIGVsZWN0cm9uLWJ1aWxkZXInKTtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMuYnVpbGRlci5kZXBlbmRlbmN5LmJ1aWxkKE9iamVjdC5hc3NpZ24oe1xuICAgICAgICAgICAgICAgIHRhcmdldHM6IHRoaXMucHJlcGFyZVRhcmdldHMoKSxcbiAgICAgICAgICAgICAgICBjb25maWc6IGJ1aWxkZXJPcHRpb25zXG4gICAgICAgICAgICB9LCBzZXR0aW5ncy5idWlsZGVyQ2xpT3B0aW9ucykpO1xuXG4gICAgICAgICAgICBpZiAodGhpcy4kLnV0aWxzLmV4aXN0cyh0aGlzLiQuZW52LnBhdGhzLmVsZWN0cm9uQXBwLmV4dHJhY3RlZE5vZGVNb2R1bGVzKSkge1xuICAgICAgICAgICAgICAgIHNoZWxsLnJtKCctcmYnLCB0aGlzLiQuZW52LnBhdGhzLmVsZWN0cm9uQXBwLmV4dHJhY3RlZE5vZGVNb2R1bGVzKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICAgICAgdGhpcy5sb2cuZXJyb3IoJ2Vycm9yIHdoaWxlIGJ1aWxkaW5nIGluc3RhbGxlcjogJywgZSk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBNb3ZlcyBub2RlX21vZHVsZXMgb3V0IG9mIHRoZSBhcHAgYmVjYXVzZSB3aGlsZSB0aGUgYXBwIHdpbGwgYmUgcGFja2FnZWRcbiAgICAgKiB3ZSBkbyBub3Qgd2FudCBpdCB0byBiZSB0aGVyZS5cbiAgICAgKiBAcmV0dXJucyB7UHJvbWlzZTxhbnk+fVxuICAgICAqL1xuICAgIG1vdmVOb2RlTW9kdWxlc091dCgpIHtcbiAgICAgICAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgICAgICAgIHRoaXMubG9nLmRlYnVnKCdtb3Zpbmcgbm9kZV9tb2R1bGVzIG91dCwgYmVjYXVzZSB3ZSBoYXZlIHRoZW0gYWxyZWFkeSBpbicgK1xuICAgICAgICAgICAgICAgICcgYXBwLmFzYXInKTtcbiAgICAgICAgICAgIHRoaXMua2lsbE1TQnVpbGQoKTtcbiAgICAgICAgICAgIHJlbW92ZURpcih0aGlzLiQuZW52LnBhdGhzLmVsZWN0cm9uQXBwLnRtcE5vZGVNb2R1bGVzKVxuICAgICAgICAgICAgICAgIC5jYXRjaChlID0+IHJlamVjdChlKSlcbiAgICAgICAgICAgICAgICAudGhlbigoKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgIHNoZWxsLmNvbmZpZy5mYXRhbCA9IHRydWU7XG4gICAgICAgICAgICAgICAgICAgIHNoZWxsLmNvbmZpZy52ZXJib3NlID0gdHJ1ZTtcbiAgICAgICAgICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHNoZWxsLm12KFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuJC5lbnYucGF0aHMuZWxlY3Ryb25BcHAubm9kZU1vZHVsZXMsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy4kLmVudi5wYXRocy5lbGVjdHJvbkFwcC50bXBOb2RlTW9kdWxlc1xuICAgICAgICAgICAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIHNoZWxsLmNvbmZpZy5yZXNldCgpO1xuICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHRoaXMud2FpdCgpO1xuICAgICAgICAgICAgICAgICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBzaGVsbC5jb25maWcucmVzZXQoKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiBQcm9taXNlLnJlamVjdChlKTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH0pXG4gICAgICAgICAgICAgICAgLmNhdGNoKGUgPT4gcmVqZWN0KGUpKVxuICAgICAgICAgICAgICAgIC50aGVuKCgpID0+IHJlbW92ZURpcih0aGlzLiQuZW52LnBhdGhzLmVsZWN0cm9uQXBwLm5vZGVNb2R1bGVzLCAxMDAwKSlcbiAgICAgICAgICAgICAgICAuY2F0Y2goZSA9PiByZWplY3QoZSkpXG4gICAgICAgICAgICAgICAgLnRoZW4oKCkgPT4gdGhpcy53YWl0KCkpXG4gICAgICAgICAgICAgICAgLmNhdGNoKHJlamVjdClcbiAgICAgICAgICAgICAgICAudGhlbihyZXNvbHZlKTtcbiAgICAgICAgfSk7XG4gICAgfVxufVxuIl0sIm1hcHBpbmdzIjoiOzs7Ozs7QUFDQSxJQUFBQSxRQUFBLEdBQUFDLHNCQUFBLENBQUFDLE9BQUE7QUFDQSxJQUFBQyxRQUFBLEdBQUFGLHNCQUFBLENBQUFDLE9BQUE7QUFDQSxJQUFBRSxLQUFBLEdBQUFILHNCQUFBLENBQUFDLE9BQUE7QUFDQSxJQUFBRyxHQUFBLEdBQUFKLHNCQUFBLENBQUFDLE9BQUE7QUFDQSxJQUFBSSxPQUFBLEdBQUFMLHNCQUFBLENBQUFDLE9BQUE7QUFDQSxJQUFBSyxXQUFBLEdBQUFOLHNCQUFBLENBQUFDLE9BQUE7QUFDQSxJQUFBTSxJQUFBLEdBQUFQLHNCQUFBLENBQUFDLE9BQUE7QUFDQSxJQUFBTyxvQkFBQSxHQUFBUixzQkFBQSxDQUFBQyxPQUFBO0FBQXdELFNBQUFELHVCQUFBUyxDQUFBLFdBQUFBLENBQUEsSUFBQUEsQ0FBQSxDQUFBQyxVQUFBLEdBQUFELENBQUEsS0FBQUUsT0FBQSxFQUFBRixDQUFBO0FBUnhEOztBQVVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EsU0FBU0csU0FBU0EsQ0FBQ0MsT0FBTyxFQUFFQyxLQUFLLEdBQUcsQ0FBQyxFQUFFO0VBQ25DLE9BQU8sSUFBSUMsT0FBTyxDQUFDLENBQUNDLE9BQU8sRUFBRUMsTUFBTSxLQUFLO0lBQ3BDQyxVQUFVLENBQUMsTUFBTTtNQUNiLElBQUFDLGVBQU0sRUFBQ04sT0FBTyxFQUFFO1FBQ1pPLFlBQVksRUFBRTtN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