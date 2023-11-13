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
function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJfcnVudGltZSIsIl9pbnRlcm9wUmVxdWlyZURlZmF1bHQiLCJyZXF1aXJlIiwiX3NoZWxsanMiLCJfcGF0aCIsIl9mcyIsIl9yaW1yYWYiLCJfY3Jvc3NTcGF3biIsIl9sb2ciLCJfZGVmYXVsdERlcGVuZGVuY2llcyIsIm9iaiIsIl9fZXNNb2R1bGUiLCJkZWZhdWx0IiwicmVtb3ZlRGlyIiwiZGlyUGF0aCIsImRlbGF5IiwiUHJvbWlzZSIsInJlc29sdmUiLCJyZWplY3QiLCJzZXRUaW1lb3V0IiwicmltcmFmIiwibWF4QnVzeVRyaWVzIiwiZXJyIiwiSW5zdGFsbGVyQnVpbGRlciIsImNvbnN0cnVjdG9yIiwiJCIsImxvZyIsIkxvZyIsImZpcnN0UGFzcyIsImxhc3RSZWJ1aWxkIiwiY3VycmVudENvbnRleHQiLCJpbnN0YWxsZXJEaXIiLCJwYXRoIiwiam9pbiIsImVudiIsIm9wdGlvbnMiLCJvdXRwdXQiLCJwYXRocyIsInBsYXRmb3JtcyIsImluaXQiLCJidWlsZGVyIiwiZ2V0RGVwZW5kZW5jeSIsImRlZmF1bHREZXBlbmRlbmNpZXMiLCJhcHBCdWlsZGVyIiwieWFybiIsImdldEd5cEVudiIsInBhY2thZ2VEZXBlbmRlbmNpZXMiLCJwcmVwYXJlTGFzdFJlYnVpbGRPYmplY3QiLCJhcmNoIiwicGxhdGZvcm0iLCJwcm9jZXNzIiwicHJvZHVjdGlvbkRlcHMiLCJjcmVhdGVMYXp5UHJvZHVjdGlvbkRlcHMiLCJlbGVjdHJvbkFwcCIsInJvb3QiLCJmcmFtZXdvcmtJbmZvIiwidmVyc2lvbiIsImdldEVsZWN0cm9uVmVyc2lvbiIsInVzZUN1c3RvbURpc3QiLCJpbnN0YWxsT3JSZWJ1aWxkIiwiaW5zdGFsbCIsImRlYnVnIiwiZGVza3RvcCIsImdldFNldHRpbmdzIiwiYnVpbGRlck9wdGlvbnMiLCJiZWZvcmVCdWlsZCIsImNvbnRleHQiLCJPYmplY3QiLCJhc3NpZ24iLCJwbGF0Zm9ybU1hdGNoZXMiLCJub2RlTmFtZSIsInJlYnVpbGQiLCJ3YXJuIiwibW92ZU5vZGVNb2R1bGVzT3V0IiwiY2F0Y2giLCJlIiwidGhlbiIsImluc3RhbGxMb2NhbE5vZGVNb2R1bGVzIiwic2NhZmZvbGQiLCJjcmVhdGVBcHBSb290IiwiY29weVNrZWxldG9uQXBwIiwicGFja1NrZWxldG9uVG9Bc2FyIiwibWV0ZW9yQXNhciIsImRlc2t0b3BBc2FyIiwiZXh0cmFjdGVkIiwiYWZ0ZXJQYWNrIiwiZmlsdGVyIiwiZWxlY3Ryb25QbGF0Zm9ybU5hbWUiLCJsZW5ndGgiLCJzaGVsbCIsImNvbmZpZyIsImZhdGFsIiwidXRpbHMiLCJleGlzdHMiLCJleHRyYWN0ZWROb2RlTW9kdWxlcyIsImNwIiwiZ2V0UGFja2FnZWRBcHBQYXRoIiwibXYiLCJ0bXBOb2RlTW9kdWxlcyIsIm5vZGVNb2R1bGVzIiwicmVzZXQiLCJ3YWl0Iiwia2lsbE1TQnVpbGQiLCJvdXQiLCJzcGF3biIsInN5bmMiLCJzdGRvdXQiLCJ0b1N0cmluZyIsInNwbGl0IiwicmVnZXgiLCJSZWdFeHAiLCJmb3JFYWNoIiwibGluZSIsIm1hdGNoIiwiZXhlYyIsImxhc3RJbmRleCIsInBhY2thZ2VyIiwiYXBwSW5mbyIsInByb2R1Y3RGaWxlbmFtZSIsInBsYXRmb3JtRGlyIiwiYXBwQXNhclBhdGgiLCJyZXRyaWVzIiwic2VsZiIsImNoZWNrIiwiZnMiLCJvcGVuIiwiZmQiLCJjb2RlIiwiY2xvc2VTeW5jIiwicHJlcGFyZVRhcmdldHMiLCJpYTMyIiwiYWxsQXJjaHMiLCJ0YXJnZXRzIiwid2luIiwicHVzaCIsImRlcGVuZGVuY3kiLCJQbGF0Zm9ybSIsIldJTkRPV1MiLCJsaW51eCIsIkxJTlVYIiwibWFjIiwiTUFDIiwib3MiLCJpc1dpbmRvd3MiLCJpc0xpbnV4IiwiY3JlYXRlVGFyZ2V0cyIsImJ1aWxkIiwic2V0dGluZ3MiLCJlcnJvciIsImV4aXQiLCJhc2FyIiwibnBtUmVidWlsZCIsImJpbmQiLCJlbGVjdHJvblZlcnNpb24iLCJkaXJlY3RvcmllcyIsImFwcCIsInRhcmdldCIsImluY2x1ZGVzIiwiYnVpbGRlckNsaU9wdGlvbnMiLCJybSIsInZlcmJvc2UiLCJleHBvcnRzIl0sInNvdXJjZXMiOlsiLi4vbGliL2VsZWN0cm9uQnVpbGRlci5qcyJdLCJzb3VyY2VzQ29udGVudCI6WyIvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgbm8tdW51c2VkLXZhcnNcbmltcG9ydCByZWdlbmVyYXRvclJ1bnRpbWUgZnJvbSAncmVnZW5lcmF0b3ItcnVudGltZS9ydW50aW1lJztcbmltcG9ydCBzaGVsbCBmcm9tICdzaGVsbGpzJztcbmltcG9ydCBwYXRoIGZyb20gJ3BhdGgnO1xuaW1wb3J0IGZzIGZyb20gJ2ZzJztcbmltcG9ydCByaW1yYWYgZnJvbSAncmltcmFmJztcbmltcG9ydCBzcGF3biBmcm9tICdjcm9zcy1zcGF3bic7XG5pbXBvcnQgTG9nIGZyb20gJy4vbG9nJztcbmltcG9ydCBkZWZhdWx0RGVwZW5kZW5jaWVzIGZyb20gJy4vZGVmYXVsdERlcGVuZGVuY2llcyc7XG5cbi8qKlxuICogUHJvbWlzZmllZCByaW1yYWYuXG4gKlxuICogQHBhcmFtIHtzdHJpbmd9IGRpclBhdGggLSBwYXRoIHRvIHRoZSBkaXIgdG8gYmUgZGVsZXRlZFxuICogQHBhcmFtIHtudW1iZXJ9IGRlbGF5IC0gZGVsYXkgdGhlIHRhc2sgYnkgbXNcbiAqIEByZXR1cm5zIHtQcm9taXNlPGFueT59XG4gKi9cbmZ1bmN0aW9uIHJlbW92ZURpcihkaXJQYXRoLCBkZWxheSA9IDApIHtcbiAgICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgICAgICBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgICAgICAgIHJpbXJhZihkaXJQYXRoLCB7XG4gICAgICAgICAgICAgICAgbWF4QnVzeVRyaWVzOiAxMDBcbiAgICAgICAgICAgIH0sIChlcnIpID0+IHtcbiAgICAgICAgICAgICAgICBpZiAoZXJyKSB7XG4gICAgICAgICAgICAgICAgICAgIHJlamVjdChlcnIpO1xuICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgIHJlc29sdmUoKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfSwgZGVsYXkpO1xuICAgIH0pO1xufVxuXG4vKipcbiAqIFdyYXBwZXIgZm9yIGVsZWN0cm9uLWJ1aWxkZXIuXG4gKi9cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIEluc3RhbGxlckJ1aWxkZXIge1xuICAgIC8qKlxuICAgICAqIEBwYXJhbSB7TWV0ZW9yRGVza3RvcH0gJCAtIGNvbnRleHRcbiAgICAgKlxuICAgICAqIEBjb25zdHJ1Y3RvclxuICAgICAqL1xuICAgIGNvbnN0cnVjdG9yKCQpIHtcbiAgICAgICAgdGhpcy5sb2cgPSBuZXcgTG9nKCdlbGVjdHJvbkJ1aWxkZXInKTtcbiAgICAgICAgdGhpcy4kID0gJDtcbiAgICAgICAgdGhpcy5maXJzdFBhc3MgPSB0cnVlO1xuICAgICAgICB0aGlzLmxhc3RSZWJ1aWxkID0ge307XG4gICAgICAgIHRoaXMuY3VycmVudENvbnRleHQgPSBudWxsO1xuICAgICAgICB0aGlzLmluc3RhbGxlckRpciA9IHBhdGguam9pbih0aGlzLiQuZW52Lm9wdGlvbnMub3V0cHV0LCB0aGlzLiQuZW52LnBhdGhzLmluc3RhbGxlckRpcik7XG4gICAgICAgIHRoaXMucGxhdGZvcm1zID0gW107XG4gICAgfVxuXG4gICAgYXN5bmMgaW5pdCgpIHtcbiAgICAgICAgdGhpcy5idWlsZGVyID0gYXdhaXQgdGhpcy4kLmdldERlcGVuZGVuY3koJ2VsZWN0cm9uLWJ1aWxkZXInLCBkZWZhdWx0RGVwZW5kZW5jaWVzWydlbGVjdHJvbi1idWlsZGVyJ10pO1xuICAgICAgICBjb25zdCBhcHBCdWlsZGVyID0gYXdhaXQgdGhpcy4kLmdldERlcGVuZGVuY3koJ2FwcC1idWlsZGVyLWxpYicsIGRlZmF1bHREZXBlbmRlbmNpZXNbJ2VsZWN0cm9uLWJ1aWxkZXInXSwgZmFsc2UpO1xuXG4gICAgICAgIHRoaXMueWFybiA9IHJlcXVpcmUocGF0aC5qb2luKGFwcEJ1aWxkZXIucGF0aCwgJ291dCcsICd1dGlsJywgJ3lhcm4nKSk7XG4gICAgICAgIHRoaXMuZ2V0R3lwRW52ID0gdGhpcy55YXJuLmdldEd5cEVudjtcbiAgICAgICAgdGhpcy5wYWNrYWdlRGVwZW5kZW5jaWVzID0gcmVxdWlyZShwYXRoLmpvaW4oYXBwQnVpbGRlci5wYXRoLCAnb3V0JywgJ3V0aWwnLCAncGFja2FnZURlcGVuZGVuY2llcycpKTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBQcmVwYXJlcyB0aGUgbGFzdCByZWJ1aWxkIG9iamVjdCBmb3IgZWxlY3Ryb24tYnVpbGRlci5cbiAgICAgKlxuICAgICAqIEBwYXJhbSB7c3RyaW5nfSBhcmNoXG4gICAgICogQHBhcmFtIHtzdHJpbmd9IHBsYXRmb3JtXG4gICAgICogQHJldHVybnMge09iamVjdH1cbiAgICAgKi9cbiAgICBwcmVwYXJlTGFzdFJlYnVpbGRPYmplY3QoYXJjaCwgcGxhdGZvcm0gPSBwcm9jZXNzLnBsYXRmb3JtKSB7XG4gICAgICAgIGNvbnN0IHByb2R1Y3Rpb25EZXBzID0gdGhpcy5wYWNrYWdlRGVwZW5kZW5jaWVzXG4gICAgICAgICAgICAuY3JlYXRlTGF6eVByb2R1Y3Rpb25EZXBzKHRoaXMuJC5lbnYucGF0aHMuZWxlY3Ryb25BcHAucm9vdCk7XG4gICAgICAgIHRoaXMubGFzdFJlYnVpbGQgPSB7XG4gICAgICAgICAgICBmcmFtZXdvcmtJbmZvOiB7IHZlcnNpb246IHRoaXMuJC5nZXRFbGVjdHJvblZlcnNpb24oKSwgdXNlQ3VzdG9tRGlzdDogdHJ1ZSB9LFxuICAgICAgICAgICAgcGxhdGZvcm0sXG4gICAgICAgICAgICBhcmNoLFxuICAgICAgICAgICAgcHJvZHVjdGlvbkRlcHNcbiAgICAgICAgfTtcbiAgICAgICAgcmV0dXJuIHRoaXMubGFzdFJlYnVpbGQ7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogQ2FsbHMgbnBtIHJlYnVpbGQgZnJvbSBlbGVjdHJvbi1idWlsZGVyLlxuICAgICAqIEBwYXJhbSB7c3RyaW5nfSBhcmNoXG4gICAgICogQHBhcmFtIHtzdHJpbmd9IHBsYXRmb3JtXG4gICAgICogQHBhcmFtIHtib29sZWFufSBpbnN0YWxsXG4gICAgICogQHJldHVybnMge1Byb21pc2V9XG4gICAgICovXG4gICAgYXN5bmMgaW5zdGFsbE9yUmVidWlsZChhcmNoLCBwbGF0Zm9ybSA9IHByb2Nlc3MucGxhdGZvcm0sIGluc3RhbGwgPSBmYWxzZSkge1xuICAgICAgICB0aGlzLmxvZy5kZWJ1ZyhgY2FsbGluZyBpbnN0YWxsT3JSZWJ1aWxkIGZyb20gZWxlY3Ryb24tYnVpbGRlciBmb3IgYXJjaCAke2FyY2h9YCk7XG4gICAgICAgIHRoaXMucHJlcGFyZUxhc3RSZWJ1aWxkT2JqZWN0KGFyY2gsIHBsYXRmb3JtKTtcbiAgICAgICAgYXdhaXQgdGhpcy55YXJuLmluc3RhbGxPclJlYnVpbGQodGhpcy4kLmRlc2t0b3AuZ2V0U2V0dGluZ3MoKS5idWlsZGVyT3B0aW9ucyB8fCB7fSxcbiAgICAgICAgICAgIHRoaXMuJC5lbnYucGF0aHMuZWxlY3Ryb25BcHAucm9vdCwgdGhpcy5sYXN0UmVidWlsZCwgaW5zdGFsbCk7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogQ2FsbGJhY2sgaW52b2tlZCBiZWZvcmUgYnVpbGQgaXMgbWFkZS4gRW5zdXJlcyB0aGF0IGFwcC5hc2FyIGhhdmUgdGhlIHJpZ2h0IHJlYnVpbHRcbiAgICAgKiBub2RlX21vZHVsZXMuXG4gICAgICpcbiAgICAgKiBAcGFyYW0ge09iamVjdH0gY29udGV4dFxuICAgICAqIEByZXR1cm5zIHtQcm9taXNlfVxuICAgICAqL1xuICAgIGJlZm9yZUJ1aWxkKGNvbnRleHQpIHtcbiAgICAgICAgdGhpcy5jdXJyZW50Q29udGV4dCA9IE9iamVjdC5hc3NpZ24oe30sIGNvbnRleHQpO1xuICAgICAgICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgICAgICAgICAgY29uc3QgcGxhdGZvcm1NYXRjaGVzID0gcHJvY2Vzcy5wbGF0Zm9ybSA9PT0gY29udGV4dC5wbGF0Zm9ybS5ub2RlTmFtZTtcbiAgICAgICAgICAgIGNvbnN0IHJlYnVpbGQgPSBwbGF0Zm9ybU1hdGNoZXMgJiYgY29udGV4dC5hcmNoICE9PSB0aGlzLmxhc3RSZWJ1aWxkLmFyY2g7XG4gICAgICAgICAgICBpZiAoIXBsYXRmb3JtTWF0Y2hlcykge1xuICAgICAgICAgICAgICAgIHRoaXMubG9nLndhcm4oJ3NraXBwaW5nIGRlcGVuZGVuY2llcyByZWJ1aWxkIGJlY2F1c2UgcGxhdGZvcm0gaXMgZGlmZmVyZW50LCBpZiB5b3UgaGF2ZSBuYXRpdmUgJyArXG4gICAgICAgICAgICAgICAgICAgICdub2RlIG1vZHVsZXMgYXMgeW91ciBhcHAgZGVwZW5kZW5jaWVzIHlvdSBzaG91bGQgb2QgdGhlIGJ1aWxkIG9uIHRoZSB0YXJnZXQgcGxhdGZvcm0gb25seScpO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpZiAoIXJlYnVpbGQpIHtcbiAgICAgICAgICAgICAgICB0aGlzLm1vdmVOb2RlTW9kdWxlc091dCgpXG4gICAgICAgICAgICAgICAgICAgIC5jYXRjaChlID0+IHJlamVjdChlKSlcbiAgICAgICAgICAgICAgICAgICAgLnRoZW4oKCkgPT4gc2V0VGltZW91dCgoKSA9PiByZXNvbHZlKGZhbHNlKSwgMjAwMCkpO1xuICAgICAgICAgICAgICAgIC8vIFRpbWVvdXQgaGVscHMgb24gV2luZG93cyB0byBjbGVhciB0aGUgZmlsZSBsb2Nrcy5cbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgLy8gTGV0cyByZWJ1aWxkIHRoZSBub2RlX21vZHVsZXMgZm9yIGRpZmZlcmVudCBhcmNoLlxuICAgICAgICAgICAgICAgIHRoaXMuaW5zdGFsbE9yUmVidWlsZChjb250ZXh0LmFyY2gsIGNvbnRleHQucGxhdGZvcm0ubm9kZU5hbWUpXG4gICAgICAgICAgICAgICAgICAgIC5jYXRjaChlID0+IHJlamVjdChlKSlcbiAgICAgICAgICAgICAgICAgICAgLnRoZW4oKCkgPT4gdGhpcy4kLmVsZWN0cm9uQXBwLmluc3RhbGxMb2NhbE5vZGVNb2R1bGVzKGNvbnRleHQuYXJjaCkpXG4gICAgICAgICAgICAgICAgICAgIC5jYXRjaChlID0+IHJlamVjdChlKSlcbiAgICAgICAgICAgICAgICAgICAgLnRoZW4oKCkgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy4kLmVsZWN0cm9uQXBwLnNjYWZmb2xkLmNyZWF0ZUFwcFJvb3QoKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuJC5lbGVjdHJvbkFwcC5zY2FmZm9sZC5jb3B5U2tlbGV0b25BcHAoKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiB0aGlzLiQuZWxlY3Ryb25BcHAucGFja1NrZWxldG9uVG9Bc2FyKFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIFtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy4kLmVudi5wYXRocy5lbGVjdHJvbkFwcC5tZXRlb3JBc2FyLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aGlzLiQuZW52LnBhdGhzLmVsZWN0cm9uQXBwLmRlc2t0b3BBc2FyLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aGlzLiQuZW52LnBhdGhzLmVsZWN0cm9uQXBwLmV4dHJhY3RlZFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIF1cbiAgICAgICAgICAgICAgICAgICAgICAgICk7XG4gICAgICAgICAgICAgICAgICAgIH0pXG4gICAgICAgICAgICAgICAgICAgIC5jYXRjaChlID0+IHJlamVjdChlKSlcbiAgICAgICAgICAgICAgICAgICAgLnRoZW4oKCkgPT4gdGhpcy5tb3ZlTm9kZU1vZHVsZXNPdXQoKSlcbiAgICAgICAgICAgICAgICAgICAgLmNhdGNoKGUgPT4gcmVqZWN0KGUpKVxuICAgICAgICAgICAgICAgICAgICAudGhlbigoKSA9PiByZXNvbHZlKGZhbHNlKSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIENhbGxiYWNrIHRvIGJlIGludm9rZWQgYWZ0ZXIgcGFja2luZy4gUmVzdG9yZXMgbm9kZV9tb2R1bGVzIHRvIHRoZSAuZGVza3RvcC1idWlsZC5cbiAgICAgKiBAcmV0dXJucyB7UHJvbWlzZX1cbiAgICAgKi9cbiAgICBhZnRlclBhY2soY29udGV4dCkge1xuICAgICAgICB0aGlzLnBsYXRmb3JtcyA9IHRoaXMucGxhdGZvcm1zXG4gICAgICAgICAgICAuZmlsdGVyKHBsYXRmb3JtID0+IHBsYXRmb3JtICE9PSBjb250ZXh0LmVsZWN0cm9uUGxhdGZvcm1OYW1lKTtcbiAgICAgICAgaWYgKHRoaXMucGxhdGZvcm1zLmxlbmd0aCAhPT0gMCkge1xuICAgICAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICAgICAgICBzaGVsbC5jb25maWcuZmF0YWwgPSB0cnVlO1xuXG4gICAgICAgICAgICBpZiAodGhpcy4kLnV0aWxzLmV4aXN0cyh0aGlzLiQuZW52LnBhdGhzLmVsZWN0cm9uQXBwLmV4dHJhY3RlZE5vZGVNb2R1bGVzKSkge1xuICAgICAgICAgICAgICAgIHRoaXMubG9nLmRlYnVnKCdpbmplY3RpbmcgZXh0cmFjdGVkIG1vZHVsZXMnKTtcbiAgICAgICAgICAgICAgICBzaGVsbC5jcChcbiAgICAgICAgICAgICAgICAgICAgJy1SZicsXG4gICAgICAgICAgICAgICAgICAgIHRoaXMuJC5lbnYucGF0aHMuZWxlY3Ryb25BcHAuZXh0cmFjdGVkTm9kZU1vZHVsZXMsXG4gICAgICAgICAgICAgICAgICAgIHBhdGguam9pbih0aGlzLmdldFBhY2thZ2VkQXBwUGF0aChjb250ZXh0KSwgJ25vZGVfbW9kdWxlcycpXG4gICAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgdGhpcy5sb2cuZGVidWcoJ21vdmluZyBub2RlX21vZHVsZXMgYmFjaycpO1xuICAgICAgICAgICAgLy8gTW92ZSBub2RlX21vZHVsZXMgYmFjay5cblxuICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICBzaGVsbC5tdihcbiAgICAgICAgICAgICAgICAgICAgdGhpcy4kLmVudi5wYXRocy5lbGVjdHJvbkFwcC50bXBOb2RlTW9kdWxlcyxcbiAgICAgICAgICAgICAgICAgICAgdGhpcy4kLmVudi5wYXRocy5lbGVjdHJvbkFwcC5ub2RlTW9kdWxlc1xuICAgICAgICAgICAgICAgICk7XG4gICAgICAgICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgICAgICAgICAgcmVqZWN0KGUpO1xuICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgIH0gZmluYWxseSB7XG4gICAgICAgICAgICAgICAgc2hlbGwuY29uZmlnLnJlc2V0KCk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGlmICh0aGlzLmZpcnN0UGFzcykge1xuICAgICAgICAgICAgICAgIHRoaXMuZmlyc3RQYXNzID0gZmFsc2U7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICB0aGlzLmxvZy5kZWJ1Zygnbm9kZV9tb2R1bGVzIG1vdmVkIGJhY2snKTtcblxuICAgICAgICAgICAgdGhpcy53YWl0KClcbiAgICAgICAgICAgICAgICAuY2F0Y2goZSA9PiByZWplY3QoZSkpXG4gICAgICAgICAgICAgICAgLnRoZW4oKCkgPT4gcmVzb2x2ZSgpKTtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogVGhpcyBjb21tYW5kIGtpbGxzIG9ycGhhbmVkIE1TQnVpbGQuZXhlIHByb2Nlc3Nlcy5cbiAgICAgKiBTb21ldGltZSBhZnRlciBuYXRpdmUgbm9kZV9tb2R1bGVzIGNvbXBpbGF0aW9uIHRoZXkgYXJlIHN0aWxsIHdyaXRpbmcgc29tZSBsb2dzLFxuICAgICAqIHByZXZlbnQgbm9kZV9tb2R1bGVzIGZyb20gYmVpbmcgZGVsZXRlZC5cbiAgICAgKi9cbiAgICBraWxsTVNCdWlsZCgpIHtcbiAgICAgICAgaWYgKHRoaXMuY3VycmVudENvbnRleHQucGxhdGZvcm0ubm9kZU5hbWUgIT09ICd3aW4zMicpIHtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICB0cnkge1xuICAgICAgICAgICAgY29uc3Qgb3V0ID0gc3Bhd25cbiAgICAgICAgICAgICAgICAuc3luYyhcbiAgICAgICAgICAgICAgICAgICAgJ3dtaWMnLFxuICAgICAgICAgICAgICAgICAgICBbJ3Byb2Nlc3MnLCAnd2hlcmUnLCAnY2FwdGlvbj1cIk1TQnVpbGQuZXhlXCInLCAnZ2V0JywgJ3Byb2Nlc3NpZCddXG4gICAgICAgICAgICAgICAgKVxuICAgICAgICAgICAgICAgIC5zdGRvdXQudG9TdHJpbmcoJ3V0Zi04JylcbiAgICAgICAgICAgICAgICAuc3BsaXQoJ1xcbicpO1xuXG4gICAgICAgICAgICBjb25zdCByZWdleCA9IG5ldyBSZWdFeHAoLyhcXGQrKS8sICdnbScpO1xuICAgICAgICAgICAgLy8gTm8gd2Ugd2lsbCBjaGVjayBmb3IgdGhvc2Ugd2l0aCB0aGUgbWF0Y2hpbmcgcGFyYW1zLlxuICAgICAgICAgICAgb3V0LmZvckVhY2goKGxpbmUpID0+IHtcbiAgICAgICAgICAgICAgICBjb25zdCBtYXRjaCA9IHJlZ2V4LmV4ZWMobGluZSkgfHwgZmFsc2U7XG4gICAgICAgICAgICAgICAgaWYgKG1hdGNoKSB7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMubG9nLmRlYnVnKGBraWxsaW5nIE1TQnVpbGQuZXhlIGF0IHBpZDogJHttYXRjaFsxXX1gKTtcbiAgICAgICAgICAgICAgICAgICAgc3Bhd24uc3luYygndGFza2tpbGwnLCBbJy9waWQnLCBtYXRjaFsxXSwgJy9mJywgJy90J10pO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICByZWdleC5sYXN0SW5kZXggPSAwO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgICAgIHRoaXMubG9nLmRlYnVnKCdraWxsIE1TQnVpbGQgZmFpbGVkJyk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBSZXR1cm5zIHRoZSBwYXRoIHRvIHBhY2thZ2VkIGFwcC5cbiAgICAgKiBAcmV0dXJucyB7c3RyaW5nfVxuICAgICAqL1xuICAgIGdldFBhY2thZ2VkQXBwUGF0aChjb250ZXh0ID0ge30pIHtcbiAgICAgICAgaWYgKHRoaXMuY3VycmVudENvbnRleHQucGxhdGZvcm0ubm9kZU5hbWUgPT09ICdkYXJ3aW4nKSB7XG4gICAgICAgICAgICByZXR1cm4gcGF0aC5qb2luKFxuICAgICAgICAgICAgICAgIHRoaXMuaW5zdGFsbGVyRGlyLFxuICAgICAgICAgICAgICAgICdtYWMnLFxuICAgICAgICAgICAgICAgIGAke2NvbnRleHQucGFja2FnZXIuYXBwSW5mby5wcm9kdWN0RmlsZW5hbWV9LmFwcGAsXG4gICAgICAgICAgICAgICAgJ0NvbnRlbnRzJywgJ1Jlc291cmNlcycsICdhcHAnXG4gICAgICAgICAgICApO1xuICAgICAgICB9XG4gICAgICAgIGNvbnN0IHBsYXRmb3JtRGlyID1cbiAgICAgICAgICAgIGAke3RoaXMuY3VycmVudENvbnRleHQucGxhdGZvcm0ubm9kZU5hbWUgPT09ICd3aW4zMicgPyAnd2luJyA6ICdsaW51eCd9LSR7dGhpcy5jdXJyZW50Q29udGV4dC5hcmNoID09PSAnaWEzMicgPyAnaWEzMi0nIDogJyd9dW5wYWNrZWRgO1xuICAgICAgICByZXR1cm4gcGF0aC5qb2luKFxuICAgICAgICAgICAgdGhpcy5pbnN0YWxsZXJEaXIsXG4gICAgICAgICAgICBwbGF0Zm9ybURpcixcbiAgICAgICAgICAgICdyZXNvdXJjZXMnLCAnYXBwJ1xuICAgICAgICApO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIE9uIFdpbmRvd3MgaXQgd2FpdHMgZm9yIHRoZSBhcHAuYXNhciBpbiB0aGUgcGFja2VkIGFwcCB0byBiZSBmcmVlIChubyBmaWxlIGxvY2tzKS5cbiAgICAgKiBAcmV0dXJucyB7Kn1cbiAgICAgKi9cbiAgICB3YWl0KCkge1xuICAgICAgICBpZiAodGhpcy5jdXJyZW50Q29udGV4dC5wbGF0Zm9ybS5ub2RlTmFtZSAhPT0gJ3dpbjMyJykge1xuICAgICAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpO1xuICAgICAgICB9XG4gICAgICAgIGNvbnN0IGFwcEFzYXJQYXRoID0gcGF0aC5qb2luKFxuICAgICAgICAgICAgdGhpcy5nZXRQYWNrYWdlZEFwcFBhdGgoKSxcbiAgICAgICAgICAgICdhcHAuYXNhcidcbiAgICAgICAgKTtcbiAgICAgICAgbGV0IHJldHJpZXMgPSAwO1xuICAgICAgICBjb25zdCBzZWxmID0gdGhpcztcbiAgICAgICAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgICAgICAgIGZ1bmN0aW9uIGNoZWNrKCkge1xuICAgICAgICAgICAgICAgIGZzLm9wZW4oYXBwQXNhclBhdGgsICdyKycsIChlcnIsIGZkKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgIHJldHJpZXMgKz0gMTtcbiAgICAgICAgICAgICAgICAgICAgaWYgKGVycikge1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGVyci5jb2RlICE9PSAnRU5PRU5UJykge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHNlbGYubG9nLmRlYnVnKGB3YWl0aW5nIGZvciBhcHAuYXNhciB0byBiZSByZWFkYWJsZSwgJHsnY29kZScgaW4gZXJyID8gYGN1cnJlbnRseSByZWFkaW5nIGl0IHJldHVybnMgJHtlcnIuY29kZX1gIDogJyd9YCk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHJldHJpZXMgPCA2KSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHNldFRpbWVvdXQoKCkgPT4gY2hlY2soKSwgNDAwMCk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcmVqZWN0KGBmaWxlIGlzIGxvY2tlZDogJHthcHBBc2FyUGF0aH1gKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJlc29sdmUoKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGZzLmNsb3NlU3luYyhmZCk7XG4gICAgICAgICAgICAgICAgICAgICAgICByZXNvbHZlKCk7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGNoZWNrKCk7XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIFByZXBhcmVzIHRoZSB0YXJnZXQgb2JqZWN0IHBhc3NlZCB0byB0aGUgZWxlY3Ryb24tYnVpbGRlci5cbiAgICAgKlxuICAgICAqIEByZXR1cm5zIHtNYXA8UGxhdGZvcm0sIE1hcDxBcmNoLCBBcnJheTxzdHJpbmc+Pj59XG4gICAgICovXG4gICAgcHJlcGFyZVRhcmdldHMoKSB7XG4gICAgICAgIGxldCBhcmNoID0gdGhpcy4kLmVudi5vcHRpb25zLmlhMzIgPyAnaWEzMicgOiAneDY0JztcbiAgICAgICAgYXJjaCA9IHRoaXMuJC5lbnYub3B0aW9ucy5hbGxBcmNocyA/ICdhbGwnIDogYXJjaDtcblxuICAgICAgICBjb25zdCB0YXJnZXRzID0gW107XG5cbiAgICAgICAgaWYgKHRoaXMuJC5lbnYub3B0aW9ucy53aW4pIHtcbiAgICAgICAgICAgIHRhcmdldHMucHVzaCh0aGlzLmJ1aWxkZXIuZGVwZW5kZW5jeS5QbGF0Zm9ybS5XSU5ET1dTKTtcbiAgICAgICAgfVxuICAgICAgICBpZiAodGhpcy4kLmVudi5vcHRpb25zLmxpbnV4KSB7XG4gICAgICAgICAgICB0YXJnZXRzLnB1c2godGhpcy5idWlsZGVyLmRlcGVuZGVuY3kuUGxhdGZvcm0uTElOVVgpO1xuICAgICAgICB9XG4gICAgICAgIGlmICh0aGlzLiQuZW52Lm9wdGlvbnMubWFjKSB7XG4gICAgICAgICAgICB0YXJnZXRzLnB1c2godGhpcy5idWlsZGVyLmRlcGVuZGVuY3kuUGxhdGZvcm0uTUFDKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmICh0YXJnZXRzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICAgICAgaWYgKHRoaXMuJC5lbnYub3MuaXNXaW5kb3dzKSB7XG4gICAgICAgICAgICAgICAgdGFyZ2V0cy5wdXNoKHRoaXMuYnVpbGRlci5kZXBlbmRlbmN5LlBsYXRmb3JtLldJTkRPV1MpO1xuICAgICAgICAgICAgfSBlbHNlIGlmICh0aGlzLiQuZW52Lm9zLmlzTGludXgpIHtcbiAgICAgICAgICAgICAgICB0YXJnZXRzLnB1c2godGhpcy5idWlsZGVyLmRlcGVuZGVuY3kuUGxhdGZvcm0uTElOVVgpO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICB0YXJnZXRzLnB1c2godGhpcy5idWlsZGVyLmRlcGVuZGVuY3kuUGxhdGZvcm0uTUFDKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gdGhpcy5idWlsZGVyLmRlcGVuZGVuY3kuY3JlYXRlVGFyZ2V0cyh0YXJnZXRzLCBudWxsLCBhcmNoKTtcbiAgICB9XG5cbiAgICBhc3luYyBidWlsZCgpIHtcbiAgICAgICAgY29uc3Qgc2V0dGluZ3MgPSB0aGlzLiQuZGVza3RvcC5nZXRTZXR0aW5ncygpO1xuICAgICAgICBpZiAoISgnYnVpbGRlck9wdGlvbnMnIGluIHNldHRpbmdzKSkge1xuICAgICAgICAgICAgdGhpcy5sb2cuZXJyb3IoXG4gICAgICAgICAgICAgICAgJ25vIGJ1aWxkZXJPcHRpb25zIGluIHNldHRpbmdzLmpzb24sIGFib3J0aW5nJ1xuICAgICAgICAgICAgKTtcbiAgICAgICAgICAgIHByb2Nlc3MuZXhpdCgxKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IGJ1aWxkZXJPcHRpb25zID0gT2JqZWN0LmFzc2lnbih7fSwgc2V0dGluZ3MuYnVpbGRlck9wdGlvbnMpO1xuXG4gICAgICAgIGJ1aWxkZXJPcHRpb25zLmFzYXIgPSBmYWxzZTtcbiAgICAgICAgYnVpbGRlck9wdGlvbnMubnBtUmVidWlsZCA9IHRydWU7XG5cbiAgICAgICAgYnVpbGRlck9wdGlvbnMuYmVmb3JlQnVpbGQgPSB0aGlzLmJlZm9yZUJ1aWxkLmJpbmQodGhpcyk7XG4gICAgICAgIGJ1aWxkZXJPcHRpb25zLmFmdGVyUGFjayA9IHRoaXMuYWZ0ZXJQYWNrLmJpbmQodGhpcyk7XG4gICAgICAgIGJ1aWxkZXJPcHRpb25zLmVsZWN0cm9uVmVyc2lvbiA9IHRoaXMuJC5nZXRFbGVjdHJvblZlcnNpb24oKTtcblxuICAgICAgICBidWlsZGVyT3B0aW9ucy5kaXJlY3RvcmllcyA9IHtcbiAgICAgICAgICAgIGFwcDogdGhpcy4kLmVudi5wYXRocy5lbGVjdHJvbkFwcC5yb290LFxuICAgICAgICAgICAgb3V0cHV0OiBwYXRoLmpvaW4odGhpcy4kLmVudi5vcHRpb25zLm91dHB1dCwgdGhpcy4kLmVudi5wYXRocy5pbnN0YWxsZXJEaXIpXG4gICAgICAgIH07XG5cbiAgICAgICAgaWYgKCdtYWMnIGluIGJ1aWxkZXJPcHRpb25zICYmICd0YXJnZXQnIGluIGJ1aWxkZXJPcHRpb25zLm1hYykge1xuICAgICAgICAgICAgaWYgKGJ1aWxkZXJPcHRpb25zLm1hYy50YXJnZXQuaW5jbHVkZXMoJ21hcycpKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5wbGF0Zm9ybXMgPSBbJ2RhcndpbicsICdtYXMnXTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICB0aGlzLmxvZy5kZWJ1ZygnY2FsbGluZyBidWlsZCBmcm9tIGVsZWN0cm9uLWJ1aWxkZXInKTtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMuYnVpbGRlci5kZXBlbmRlbmN5LmJ1aWxkKE9iamVjdC5hc3NpZ24oe1xuICAgICAgICAgICAgICAgIHRhcmdldHM6IHRoaXMucHJlcGFyZVRhcmdldHMoKSxcbiAgICAgICAgICAgICAgICBjb25maWc6IGJ1aWxkZXJPcHRpb25zXG4gICAgICAgICAgICB9LCBzZXR0aW5ncy5idWlsZGVyQ2xpT3B0aW9ucykpO1xuXG4gICAgICAgICAgICBpZiAodGhpcy4kLnV0aWxzLmV4aXN0cyh0aGlzLiQuZW52LnBhdGhzLmVsZWN0cm9uQXBwLmV4dHJhY3RlZE5vZGVNb2R1bGVzKSkge1xuICAgICAgICAgICAgICAgIHNoZWxsLnJtKCctcmYnLCB0aGlzLiQuZW52LnBhdGhzLmVsZWN0cm9uQXBwLmV4dHJhY3RlZE5vZGVNb2R1bGVzKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICAgICAgdGhpcy5sb2cuZXJyb3IoJ2Vycm9yIHdoaWxlIGJ1aWxkaW5nIGluc3RhbGxlcjogJywgZSk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBNb3ZlcyBub2RlX21vZHVsZXMgb3V0IG9mIHRoZSBhcHAgYmVjYXVzZSB3aGlsZSB0aGUgYXBwIHdpbGwgYmUgcGFja2FnZWRcbiAgICAgKiB3ZSBkbyBub3Qgd2FudCBpdCB0byBiZSB0aGVyZS5cbiAgICAgKiBAcmV0dXJucyB7UHJvbWlzZTxhbnk+fVxuICAgICAqL1xuICAgIG1vdmVOb2RlTW9kdWxlc091dCgpIHtcbiAgICAgICAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgICAgICAgIHRoaXMubG9nLmRlYnVnKCdtb3Zpbmcgbm9kZV9tb2R1bGVzIG91dCwgYmVjYXVzZSB3ZSBoYXZlIHRoZW0gYWxyZWFkeSBpbicgK1xuICAgICAgICAgICAgICAgICcgYXBwLmFzYXInKTtcbiAgICAgICAgICAgIHRoaXMua2lsbE1TQnVpbGQoKTtcbiAgICAgICAgICAgIHJlbW92ZURpcih0aGlzLiQuZW52LnBhdGhzLmVsZWN0cm9uQXBwLnRtcE5vZGVNb2R1bGVzKVxuICAgICAgICAgICAgICAgIC5jYXRjaChlID0+IHJlamVjdChlKSlcbiAgICAgICAgICAgICAgICAudGhlbigoKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgIHNoZWxsLmNvbmZpZy5mYXRhbCA9IHRydWU7XG4gICAgICAgICAgICAgICAgICAgIHNoZWxsLmNvbmZpZy52ZXJib3NlID0gdHJ1ZTtcbiAgICAgICAgICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHNoZWxsLm12KFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuJC5lbnYucGF0aHMuZWxlY3Ryb25BcHAubm9kZU1vZHVsZXMsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy4kLmVudi5wYXRocy5lbGVjdHJvbkFwcC50bXBOb2RlTW9kdWxlc1xuICAgICAgICAgICAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIHNoZWxsLmNvbmZpZy5yZXNldCgpO1xuICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHRoaXMud2FpdCgpO1xuICAgICAgICAgICAgICAgICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBzaGVsbC5jb25maWcucmVzZXQoKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiBQcm9taXNlLnJlamVjdChlKTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH0pXG4gICAgICAgICAgICAgICAgLmNhdGNoKGUgPT4gcmVqZWN0KGUpKVxuICAgICAgICAgICAgICAgIC50aGVuKCgpID0+IHJlbW92ZURpcih0aGlzLiQuZW52LnBhdGhzLmVsZWN0cm9uQXBwLm5vZGVNb2R1bGVzLCAxMDAwKSlcbiAgICAgICAgICAgICAgICAuY2F0Y2goZSA9PiByZWplY3QoZSkpXG4gICAgICAgICAgICAgICAgLnRoZW4oKCkgPT4gdGhpcy53YWl0KCkpXG4gICAgICAgICAgICAgICAgLmNhdGNoKHJlamVjdClcbiAgICAgICAgICAgICAgICAudGhlbihyZXNvbHZlKTtcbiAgICAgICAgfSk7XG4gICAgfVxufVxuIl0sIm1hcHBpbmdzIjoiOzs7Ozs7QUFDQSxJQUFBQSxRQUFBLEdBQUFDLHNCQUFBLENBQUFDLE9BQUE7QUFDQSxJQUFBQyxRQUFBLEdBQUFGLHNCQUFBLENBQUFDLE9BQUE7QUFDQSxJQUFBRSxLQUFBLEdBQUFILHNCQUFBLENBQUFDLE9BQUE7QUFDQSxJQUFBRyxHQUFBLEdBQUFKLHNCQUFBLENBQUFDLE9BQUE7QUFDQSxJQUFBSSxPQUFBLEdBQUFMLHNCQUFBLENBQUFDLE9BQUE7QUFDQSxJQUFBSyxXQUFBLEdBQUFOLHNCQUFBLENBQUFDLE9BQUE7QUFDQSxJQUFBTSxJQUFBLEdBQUFQLHNCQUFBLENBQUFDLE9BQUE7QUFDQSxJQUFBTyxvQkFBQSxHQUFBUixzQkFBQSxDQUFBQyxPQUFBO0FBQXdELFNBQUFELHVCQUFBUyxHQUFBLFdBQUFBLEdBQUEsSUFBQUEsR0FBQSxDQUFBQyxVQUFBLEdBQUFELEdBQUEsS0FBQUUsT0FBQSxFQUFBRixHQUFBO0FBUnhEOztBQVVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EsU0FBU0csU0FBU0EsQ0FBQ0MsT0FBTyxFQUFFQyxLQUFLLEdBQUcsQ0FBQyxFQUFFO0VBQ25DLE9BQU8sSUFBSUMsT0FBTyxDQUFDLENBQUNDLE9BQU8sRUFBRUMsTUFBTSxLQUFLO0lBQ3BDQyxVQUFVLENBQUMsTUFBTTtNQUNiLElBQUFDLGVBQU0sRUFBQ04sT0FBTyxFQUFFO1FBQ1pPLFlBQVks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