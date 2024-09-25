"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
var _runtime = _interopRequireDefault(require("regenerator-runtime/runtime"));
var _fs = _interopRequireDefault(require("fs"));
var _crossSpawn = _interopRequireDefault(require("cross-spawn"));
var _semver = _interopRequireDefault(require("semver"));
var _shelljs = _interopRequireDefault(require("shelljs"));
var _path = _interopRequireDefault(require("path"));
var _singleLineLog = _interopRequireDefault(require("single-line-log"));
var _asar = _interopRequireDefault(require("@electron/asar"));
var _nodeFetch = _interopRequireDefault(require("node-fetch"));
var _isDesktopInjector = _interopRequireDefault(require("../skeleton/modules/autoupdate/isDesktopInjector"));
var _log = _interopRequireDefault(require("./log"));
var _meteorManager = _interopRequireDefault(require("./meteorManager"));
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
// eslint-disable-next-line no-unused-vars

const {
  join
} = _path.default;
const sll = _singleLineLog.default.stdout;

// TODO: refactor all strategy ifs to one place

/**
 * Represents the Meteor app.
 * @property {MeteorDesktop} $
 * @class
 */
class MeteorApp {
  /**
   * @param {MeteorDesktop} $ - context
   * @constructor
   */
  constructor($) {
    this.log = new _log.default('meteorApp');
    this.$ = $;
    this.meteorManager = new _meteorManager.default($);
    this.mobilePlatform = null;
    this.oldManifest = null;
    this.injector = new _isDesktopInjector.default();
    this.matcher = new RegExp('__meteor_runtime_config__ = JSON.parse\\(decodeURIComponent\\("([^"]*)"\\)\\)');
    this.replacer = new RegExp('(__meteor_runtime_config__ = JSON.parse\\(decodeURIComponent\\()"([^"]*)"(\\)\\))');
    this.meteorVersion = null;
    this.indexHTMLstrategy = null;
    this.indexHTMLStrategies = {
      INDEX_FROM_CORDOVA_BUILD: 1,
      INDEX_FROM_RUNNING_SERVER: 2
    };
    this.deprectatedPackages = ['omega:meteor-desktop-localstorage'];
  }

  /**
   * Remove any deprecated packages from meteor project.
   * @returns {Promise<void>}
   */
  async removeDeprecatedPackages() {
    try {
      if (this.meteorManager.checkPackages(this.deprectatedPackages)) {
        this.log.info('deprecated meteor plugins found, removing them');
        await this.meteorManager.deletePackages(this.deprectatedPackages);
      }
    } catch (e) {
      throw new Error(e);
    }
  }

  /**
   * Ensures that required packages are added to the Meteor app.
   */
  async ensureDesktopHCPPackages() {
    const desktopHCPPackages = ['communitypackages:meteor-desktop-watcher', 'communitypackages:meteor-desktop-bundler'];
    if (this.$.desktop.getSettings().desktopHCP) {
      this.log.verbose('desktopHCP is enabled, checking for required packages');
      const packagesWithVersion = desktopHCPPackages.map(packageName => `${packageName}@${this.$.getVersion()}`);
      try {
        await this.meteorManager.ensurePackages(desktopHCPPackages, packagesWithVersion, 'desktopHCP');
      } catch (e) {
        throw new Error(e);
      }
    } else {
      this.log.verbose('desktopHCP is not enabled, removing required packages');
      try {
        if (this.meteorManager.checkPackages(desktopHCPPackages)) {
          await this.meteorManager.deletePackages(desktopHCPPackages);
        }
      } catch (e) {
        throw new Error(e);
      }
    }
  }

  /**
   * Adds entry to .meteor/.gitignore if necessary.
   */
  updateGitIgnore() {
    this.log.verbose('updating .meteor/.gitignore');
    // Lets read the .meteor/.gitignore and filter out blank lines.
    const gitIgnore = _fs.default.readFileSync(this.$.env.paths.meteorApp.gitIgnore, 'UTF-8').split('\n').filter(ignoredPath => ignoredPath.trim() !== '');
    if (!~gitIgnore.indexOf(this.$.env.paths.electronApp.rootName)) {
      this.log.verbose(`adding ${this.$.env.paths.electronApp.rootName} to .meteor/.gitignore`);
      gitIgnore.push(this.$.env.paths.electronApp.rootName);
      _fs.default.writeFileSync(this.$.env.paths.meteorApp.gitIgnore, gitIgnore.join('\n'), 'UTF-8');
    }
  }

  /**
   * Reads the Meteor release version used in the app.
   * @returns {string}
   */
  getMeteorRelease() {
    let release = _fs.default.readFileSync(this.$.env.paths.meteorApp.release, 'UTF-8').replace(/\r/gm, '').split('\n')[0];
    [, release] = release.split('@');
    // We do not care if it is beta.
    if (~release.indexOf('-')) {
      [release] = release.split('-');
    }
    return release;
  }

  /**
   * Cast Meteor release to semver version.
   * @returns {string}
   */
  castMeteorReleaseToSemver() {
    return `${this.getMeteorRelease()}.0.0`.match(/(^\d+\.\d+\.\d+)/gmi)[0];
  }

  /**
   * Validate meteor version against a versionRange.
   * @param {string} versionRange - semver version range
   */
  checkMeteorVersion(versionRange) {
    const release = this.castMeteorReleaseToSemver();
    if (!_semver.default.satisfies(release, versionRange)) {
      if (this.$.env.options.skipMobileBuild) {
        this.log.error(`wrong meteor version (${release}) in project - only ` + `${versionRange} is supported`);
      } else {
        this.log.error(`wrong meteor version (${release}) in project - only ` + `${versionRange} is supported for automatic meteor builds (you can always ` + 'try with `--skip-mobile-build` if you are using meteor >= 1.2.1');
      }
      process.exit(1);
    }
  }

  /**
   * Decides which strategy to use while trying to get client build out of Meteor project.
   * @returns {number}
   */
  chooseStrategy() {
    if (this.$.env.options.forceCordovaBuild) {
      return this.indexHTMLStrategies.INDEX_FROM_CORDOVA_BUILD;
    }
    const release = this.castMeteorReleaseToSemver();
    if (_semver.default.satisfies(release, '> 1.3.4')) {
      return this.indexHTMLStrategies.INDEX_FROM_RUNNING_SERVER;
    }
    if (_semver.default.satisfies(release, '1.3.4')) {
      const explodedVersion = this.getMeteorRelease().split('.');
      if (explodedVersion.length >= 4) {
        if (explodedVersion[3] > 1) {
          return this.indexHTMLStrategies.INDEX_FROM_RUNNING_SERVER;
        }
        return this.indexHTMLStrategies.INDEX_FROM_CORDOVA_BUILD;
      }
    }
    return this.indexHTMLStrategies.INDEX_FROM_CORDOVA_BUILD;
  }

  /**
   * Checks required preconditions.
   * - Meteor version
   * - is mobile platform added
   */
  async checkPreconditions() {
    if (this.$.env.options.skipMobileBuild) {
      this.checkMeteorVersion('>= 1.2.1');
    } else {
      this.checkMeteorVersion('>= 1.3.3');
      this.indexHTMLstrategy = this.chooseStrategy();
      if (this.indexHTMLstrategy === this.indexHTMLStrategies.INDEX_FROM_CORDOVA_BUILD) {
        this.log.debug('meteor version is < 1.3.4.2 so the index.html from cordova-build will' + ' be used');
      } else {
        this.log.debug('meteor version is >= 1.3.4.2 so the index.html will be downloaded ' + 'from __cordova/index.html');
      }
    }
    if (!this.$.env.options.skipMobileBuild) {
      const platforms = _fs.default.readFileSync(this.$.env.paths.meteorApp.platforms, 'UTF-8');
      if (!~platforms.indexOf('android') && !~platforms.indexOf('ios')) {
        if (!this.$.env.options.android) {
          this.mobilePlatform = 'ios';
        } else {
          this.mobilePlatform = 'android';
        }
        this.log.warn(`no mobile target detected - will add '${this.mobilePlatform}' ` + 'just to get a mobile build');
        try {
          await this.addMobilePlatform(this.mobilePlatform);
        } catch (e) {
          this.log.error('failed to add a mobile platform - please try to do it manually');
          process.exit(1);
        }
      }
    }
  }

  /**
   * Tries to add a mobile platform to meteor project.
   * @param {string} platform - platform to add
   * @returns {Promise}
   */
  addMobilePlatform(platform) {
    return new Promise((resolve, reject) => {
      this.log.verbose(`adding mobile platform: ${platform}`);
      (0, _crossSpawn.default)('meteor', ['add-platform', platform], {
        cwd: this.$.env.paths.meteorApp.root,
        stdio: this.$.env.stdio
      }).on('exit', () => {
        const platforms = _fs.default.readFileSync(this.$.env.paths.meteorApp.platforms, 'UTF-8');
        if (!~platforms.indexOf('android') && !~platforms.indexOf('ios')) {
          reject();
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * Tries to remove a mobile platform from meteor project.
   * @param {string} platform - platform to remove
   * @returns {Promise}
   */
  removeMobilePlatform(platform) {
    if (this.$.env.options.skipRemoveMobilePlatform) {
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      this.log.verbose(`removing mobile platform: ${platform}`);
      (0, _crossSpawn.default)('meteor', ['remove-platform', platform], {
        cwd: this.$.env.paths.meteorApp.root,
        stdio: this.$.env.stdio,
        env: Object.assign({
          METEOR_PRETTY_OUTPUT: 0
        }, process.env)
      }).on('exit', () => {
        const platforms = _fs.default.readFileSync(this.$.env.paths.meteorApp.platforms, 'UTF-8');
        if (~platforms.indexOf(platform)) {
          reject();
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * Just checks for index.html and program.json existence.
   * @returns {boolean}
   */
  isCordovaBuildReady() {
    if (this.indexHTMLstrategy === this.indexHTMLStrategies.INDEX_FROM_CORDOVA_BUILD) {
      return this.$.utils.exists(this.$.env.paths.meteorApp.cordovaBuildIndex) && this.$.utils.exists(this.$.env.paths.meteorApp.cordovaBuildProgramJson) && (!this.oldManifest || this.oldManifest && this.oldManifest !== _fs.default.readFileSync(this.$.env.paths.meteorApp.cordovaBuildProgramJson, 'UTF-8'));
    }
    return this.$.utils.exists(this.$.env.paths.meteorApp.webCordovaProgramJson) && (!this.oldManifest || this.oldManifest && this.oldManifest !== _fs.default.readFileSync(this.$.env.paths.meteorApp.webCordovaProgramJson, 'UTF-8'));
  }

  /**
   * Fetches index.html from running project.
   * @returns {Promise.<*>}
   */
  async acquireIndex() {
    const port = this.$.env.options.port ? this.$.env.options.port : 3080;
    this.log.info('acquiring index.html');
    const res = await (0, _nodeFetch.default)(`http://127.0.0.1:${port}/__cordova/index.html`);
    const text = await res.text();
    // Simple test if we really download index.html for web.cordova.
    if (~text.indexOf('src="/cordova.js"')) {
      return text;
    }
    return false;
  }

  /**
   * Fetches mainfest.json from running project.
   * @returns {Promise.<void>}
   */
  async acquireManifest() {
    const port = this.$.env.options.port ? this.$.env.options.port : 3080;
    this.log.info('acquiring manifest.json');
    const res = await (0, _nodeFetch.default)(`http://127.0.0.1:${port}/__cordova/manifest.json?meteor_dont_serve_index=true`);
    const text = await res.text();
    return JSON.parse(text);
  }

  /**
   * Tries to get a mobile build from meteor app.
   * In case of failure leaves a meteor.log.
   * A lot of stuff is happening here - but the main aim is to get a mobile build from
   * .meteor/local/cordova-build/www/application and exit as soon as possible.
   *
   * @returns {Promise}
   */
  buildMobileTarget() {
    const programJson = this.indexHTMLstrategy === this.indexHTMLStrategies.INDEX_FROM_CORDOVA_BUILD ? this.$.env.paths.meteorApp.cordovaBuildProgramJson : this.$.env.paths.meteorApp.webCordovaProgramJson;
    if (this.$.utils.exists(programJson)) {
      this.oldManifest = _fs.default.readFileSync(programJson, 'UTF-8');
    }
    return new Promise((resolve, reject) => {
      const self = this;
      let log = '';
      let desiredExit = false;
      let buildTimeout = null;
      let errorTimeout = null;
      let messageTimeout = null;
      let killTimeout = null;
      let cordovaCheckInterval = null;
      let portProblem = false;
      function windowsKill(pid) {
        self.log.debug(`killing pid: ${pid}`);
        _crossSpawn.default.sync('taskkill', ['/pid', pid, '/f', '/t']);

        // We will look for other process which might have been created outside the
        // process tree.
        // Lets list all node.exe processes.

        const out = _crossSpawn.default.sync('wmic', ['process', 'where', 'caption="node.exe"', 'get', 'commandline,processid']).stdout.toString('utf-8').split('\n');
        const args = self.prepareArguments();
        // Lets mount regex.
        const regexV1 = new RegExp(`${args.join('\\s+')}\\s+(\\d+)`, 'gm');
        const regexV2 = new RegExp(`"${args.join('"\\s+"')}"\\s+(\\d+)`, 'gm');
        // No we will check for those with the matching params.
        out.forEach(line => {
          const match = regexV1.exec(line) || regexV2.exec(line) || false;
          if (match) {
            self.log.debug(`killing pid: ${match[1]}`);
            _crossSpawn.default.sync('taskkill', ['/pid', match[1], '/f', '/t']);
          }
          regexV1.lastIndex = 0;
          regexV2.lastIndex = 0;
        });
      }
      function writeLog() {
        _fs.default.writeFileSync('meteor.log', log, 'UTF-8');
      }
      function clearTimeoutsAndIntervals() {
        clearInterval(cordovaCheckInterval);
        clearTimeout(buildTimeout);
        clearTimeout(errorTimeout);
        clearTimeout(messageTimeout);
        clearTimeout(killTimeout);
      }
      const args = this.prepareArguments();
      this.log.info(`running "meteor ${args.join(' ')}"... this might take a while`);
      const env = {
        METEOR_PRETTY_OUTPUT: 0,
        METEOR_NO_RELEASE_CHECK: 1
      };
      if (this.$.env.options.prodDebug) {
        env.METEOR_DESKOP_PROD_DEBUG = true;
      }

      // Lets spawn meteor.
      const child = (0, _crossSpawn.default)('meteor', args, {
        env: Object.assign(env, process.env),
        cwd: this.$.env.paths.meteorApp.root
      }, {
        shell: true
      });

      // Kills the currently running meteor command.
      function kill(signal = 'SIGKILL') {
        sll('');
        child.kill(signal);
        if (self.$.env.os.isWindows) {
          windowsKill(child.pid);
        }
      }
      function exit() {
        killTimeout = setTimeout(() => {
          clearTimeoutsAndIntervals();
          desiredExit = true;
          kill('SIGTERM');
          resolve();
        }, 500);
      }
      function copyBuild() {
        self.copyBuild().then(() => {
          exit();
        }).catch(() => {
          clearTimeoutsAndIntervals();
          kill();
          writeLog();
          reject('copy');
        });
      }
      cordovaCheckInterval = setInterval(() => {
        // Check if we already have cordova-build ready.
        if (this.isCordovaBuildReady()) {
          // If so, then exit immediately.
          if (this.indexHTMLstrategy === this.indexHTMLStrategies.INDEX_FROM_CORDOVA_BUILD) {
            copyBuild();
          }
        }
      }, 1000);
      child.stderr.on('data', chunk => {
        const line = chunk.toString('UTF-8');
        log += `${line}\n`;
        if (errorTimeout) {
          clearTimeout(errorTimeout);
        }
        // Do not exit if this is the warning for using --production.
        // Output exceeds -> https://github.com/meteor/meteor/issues/8592
        if (!~line.indexOf('--production') && !~line.indexOf('Output exceeds ') && !~line.indexOf('Node#moveTo') && !~line.indexOf('Browserslist') && Array.isArray(self.$.env.options.ignoreStderr) && self.$.env.options.ignoreStderr.every(str => !~line.indexOf(str))) {
          self.log.warn('STDERR:', line);
          // We will exit 1s after last error in stderr.
          errorTimeout = setTimeout(() => {
            clearTimeoutsAndIntervals();
            kill();
            writeLog();
            reject('error');
          }, 1000);
        }
      });
      child.stdout.on('data', chunk => {
        const line = chunk.toString('UTF-8');
        if (!desiredExit && line.trim().replace(/[\n\r\t\v\f]+/gm, '') !== '') {
          const linesToDisplay = line.trim().split('\n\r');
          // Only display last line from the chunk.
          const sanitizedLine = linesToDisplay.pop().replace(/[\n\r\t\v\f]+/gm, '');
          sll(sanitizedLine);
        }
        log += `${line}\n`;
        if (~line.indexOf('after_platform_add')) {
          sll('');
          this.log.info('done... 10%');
        }
        if (~line.indexOf('Local package version')) {
          if (messageTimeout) {
            clearTimeout(messageTimeout);
          }
          messageTimeout = setTimeout(() => {
            sll('');
            this.log.info('building in progress...');
          }, 1500);
        }
        if (~line.indexOf('Preparing Cordova project')) {
          sll('');
          this.log.info('done... 60%');
        }
        if (~line.indexOf('Can\'t listen on port')) {
          portProblem = true;
        }
        if (~line.indexOf('Your application has errors')) {
          if (errorTimeout) {
            clearTimeout(errorTimeout);
          }
          errorTimeout = setTimeout(() => {
            clearTimeoutsAndIntervals();
            kill();
            writeLog();
            reject('errorInApp');
          }, 1000);
        }
        if (~line.indexOf('App running at')) {
          copyBuild();
        }
      });

      // When Meteor exits
      child.on('exit', () => {
        sll('');
        clearTimeoutsAndIntervals();
        if (!desiredExit) {
          writeLog();
          if (portProblem) {
            reject('port');
          } else {
            reject('exit');
          }
        }
      });
      buildTimeout = setTimeout(() => {
        kill();
        writeLog();
        reject('timeout');
      }, this.$.env.options.buildTimeout ? this.$.env.options.buildTimeout * 1000 : 600000);
    });
  }

  /**
   * Replaces the DDP url that was used originally when Meteor was building the client.
   * @param {string} indexHtml - path to index.html from the client
   */
  updateDdpUrl(indexHtml) {
    let content;
    let runtimeConfig;
    try {
      content = _fs.default.readFileSync(indexHtml, 'UTF-8');
    } catch (e) {
      this.log.error(`error loading index.html file: ${e.message}`);
      process.exit(1);
    }
    if (!this.matcher.test(content)) {
      this.log.error('could not find runtime config in index file');
      process.exit(1);
    }
    try {
      const matches = content.match(this.matcher);
      runtimeConfig = JSON.parse(decodeURIComponent(matches[1]));
    } catch (e) {
      this.log.error('could not find runtime config in index file');
      process.exit(1);
    }
    if (this.$.env.options.ddpUrl.substr(-1, 1) !== '/') {
      this.$.env.options.ddpUrl += '/';
    }
    runtimeConfig.ROOT_URL = this.$.env.options.ddpUrl;
    runtimeConfig.DDP_DEFAULT_CONNECTION_URL = this.$.env.options.ddpUrl;
    content = content.replace(this.replacer, `$1"${encodeURIComponent(JSON.stringify(runtimeConfig))}"$3`);
    try {
      _fs.default.writeFileSync(indexHtml, content);
    } catch (e) {
      this.log.error(`error writing index.html file: ${e.message}`);
      process.exit(1);
    }
    this.log.info('successfully updated ddp string in the runtime config of a mobile build' + ` to ${this.$.env.options.ddpUrl}`);
  }

  /**
   * Prepares the arguments passed to `meteor` command.
   * @returns {string[]}
   */
  prepareArguments() {
    const args = ['run', '--verbose', `--mobile-server=${this.$.env.options.ddpUrl}`];
    if (this.$.env.isProductionBuild()) {
      args.push('--production');
    }
    args.push('-p');
    if (this.$.env.options.port) {
      args.push(this.$.env.options.port);
    } else {
      args.push('3080');
    }
    if (this.$.env.options.meteorSettings) {
      args.push('--settings', this.$.env.options.meteorSettings);
    }
    return args;
  }

  /**
   * Validates the mobile build and copies it into electron app.
   */
  async copyBuild() {
    this.log.debug('clearing build dir');
    try {
      await this.$.utils.rmWithRetries('-rf', this.$.env.paths.electronApp.meteorApp);
    } catch (e) {
      throw new Error(e);
    }
    let prefix = 'cordovaBuild';
    let copyPathPostfix = '';
    if (this.indexHTMLstrategy === this.indexHTMLStrategies.INDEX_FROM_RUNNING_SERVER) {
      prefix = 'webCordova';
      copyPathPostfix = `${_path.default.sep}*`;
      let indexHtml;
      try {
        _fs.default.mkdirSync(this.$.env.paths.electronApp.meteorApp);
        indexHtml = await this.acquireIndex();
        _fs.default.writeFileSync(this.$.env.paths.electronApp.meteorAppIndex, indexHtml);
        this.log.info('successfully downloaded index.html from running meteor app');
      } catch (e) {
        this.log.error('error while trying to download index.html for web.cordova, ' + 'be sure that you are running a mobile target or with' + ' --mobile-server: ', e);
        throw e;
      }
    }
    const cordovaBuild = this.$.env.paths.meteorApp[prefix];
    const {
      cordovaBuildIndex
    } = this.$.env.paths.meteorApp;
    const cordovaBuildProgramJson = this.$.env.paths.meteorApp[`${prefix}ProgramJson`];
    if (!this.$.utils.exists(cordovaBuild)) {
      this.log.error(`no mobile build found at ${cordovaBuild}`);
      this.log.error('are you sure you did run meteor with --mobile-server?');
      throw new Error('required file not present');
    }
    if (!this.$.utils.exists(cordovaBuildProgramJson)) {
      this.log.error('no program.json found in mobile build found at ' + `${cordovaBuild}`);
      this.log.error('are you sure you did run meteor with --mobile-server?');
      throw new Error('required file not present');
    }
    if (this.indexHTMLstrategy !== this.indexHTMLStrategies.INDEX_FROM_RUNNING_SERVER) {
      if (!this.$.utils.exists(cordovaBuildIndex)) {
        this.log.error('no index.html found in cordova build found at ' + `${cordovaBuild}`);
        this.log.error('are you sure you did run meteor with --mobile-server?');
        throw new Error('required file not present');
      }
    }
    this.log.verbose('copying mobile build');
    _shelljs.default.cp('-R', `${cordovaBuild}${copyPathPostfix}`, this.$.env.paths.electronApp.meteorApp);

    // Because of various permission problems here we try to clear te path by clearing
    // all possible restrictions.
    _shelljs.default.chmod('-R', '777', this.$.env.paths.electronApp.meteorApp);
    if (this.$.env.os.isWindows) {
      _shelljs.default.exec(`attrib -r ${this.$.env.paths.electronApp.meteorApp}${_path.default.sep}*.* /s`);
    }
    if (this.indexHTMLstrategy === this.indexHTMLStrategies.INDEX_FROM_RUNNING_SERVER) {
      let programJson;
      try {
        programJson = await this.acquireManifest();
        _fs.default.writeFileSync(this.$.env.paths.electronApp.meteorAppProgramJson, JSON.stringify(programJson, null, 4));
        this.log.info('successfully downloaded manifest.json from running meteor app');
      } catch (e) {
        this.log.error('error while trying to download manifest.json for web.cordova,' + ' be sure that you are running a mobile target or with' + ' --mobile-server: ', e);
        throw e;
      }
    }
    this.log.info('mobile build copied to electron app');
    this.log.debug('copy cordova.js to meteor build');
    _shelljs.default.cp(join(__dirname, '..', 'skeleton', 'cordova.js'), this.$.env.paths.electronApp.meteorApp);
  }

  /**
   * Injects Meteor.isDesktop
   */
  injectIsDesktop() {
    this.log.info('injecting isDesktop');
    let manifestJsonPath = this.$.env.paths.meteorApp.cordovaBuildProgramJson;
    if (this.indexHTMLstrategy === this.indexHTMLStrategies.INDEX_FROM_RUNNING_SERVER) {
      manifestJsonPath = this.$.env.paths.meteorApp.webCordovaProgramJson;
    }
    try {
      const {
        manifest
      } = JSON.parse(_fs.default.readFileSync(manifestJsonPath, 'UTF-8'));
      let injected = false;
      let injectedStartupDidComplete = false;
      let result = null;

      // We will search in every .js file in the manifest.
      // We could probably detect whether this is a dev or production build and only search in
      // the correct files, but for now this should be fine.
      manifest.forEach(file => {
        let fileContents;
        // Hacky way of setting isDesktop.
        if (file.type === 'js') {
          fileContents = _fs.default.readFileSync(join(this.$.env.paths.electronApp.meteorApp, file.path), 'UTF-8');
          result = this.injector.processFileContents(fileContents);
          ({
            fileContents
          } = result);
          injectedStartupDidComplete = result.injectedStartupDidComplete ? true : injectedStartupDidComplete;
          injected = result.injected ? true : injected;
          _fs.default.writeFileSync(join(this.$.env.paths.electronApp.meteorApp, file.path), fileContents);
        }
      });
      if (!injected) {
        this.log.error('error injecting isDesktop global var.');
        process.exit(1);
      }
      if (!injectedStartupDidComplete) {
        this.log.error('error injecting isDesktop for startupDidComplete');
        process.exit(1);
      }
    } catch (e) {
      this.log.error('error occurred while injecting isDesktop: ', e);
      process.exit(1);
    }
    this.log.info('injected successfully');
  }

  /**
   * Builds, modifies and copies the meteor app to electron app.
   */
  async build() {
    this.log.info('checking for any mobile platform');
    try {
      await this.checkPreconditions();
    } catch (e) {
      this.log.error('error occurred during checking preconditions: ', e);
      process.exit(1);
    }
    this.log.info('building meteor app');
    if (!this.$.env.options.skipMobileBuild) {
      try {
        await this.buildMobileTarget();
      } catch (reason) {
        switch (reason) {
          case 'timeout':
            this.log.error('timeout while building, log has been written to meteor.log');
            break;
          case 'error':
            this.log.error('build was terminated by meteor-desktop as some errors were reported to stderr, you ' + 'should see it above, also check meteor.log for more info, to ignore it use the ' + '--ignore-stderr "<string>"');
            break;
          case 'errorInApp':
            this.log.error('your meteor app has errors - look into meteor.log for more' + ' info');
            break;
          case 'port':
            this.log.error('your port 3080 is currently used (you probably have this or other ' + 'meteor project running?), use `-t` or `--meteor-port` to use ' + 'different port while building');
            break;
          case 'exit':
            this.log.error('meteor cmd exited unexpectedly, log has been written to meteor.log');
            break;
          case 'copy':
            this.log.error('error encountered when copying the build');
            break;
          default:
            this.log.error('error occurred during building mobile target', reason);
        }
        if (this.mobilePlatform) {
          await this.removeMobilePlatform(this.mobilePlatform);
        }
        process.exit(1);
      }
    } else {
      this.indexHTMLstrategy = this.chooseStrategy();
      try {
        await this.copyBuild();
      } catch (e) {
        process.exit(1);
      }
    }
    this.injectIsDesktop();
    this.changeDdpUrl();
    try {
      await this.packToAsar();
    } catch (e) {
      this.log.error('error while packing meteor app to asar');
      process.exit(1);
    }
    this.log.info('meteor build finished');
    if (this.mobilePlatform) {
      await this.removeMobilePlatform(this.mobilePlatform);
    }
  }
  changeDdpUrl() {
    if (this.$.env.options.ddpUrl !== null) {
      try {
        this.updateDdpUrl(this.$.env.paths.electronApp.meteorAppIndex);
      } catch (e) {
        this.log.error(`error while trying to change the ddp url: ${e.message}`);
      }
    }
  }
  packToAsar() {
    this.log.info('packing meteor app to asar archive');
    return new Promise((resolve, reject) => _asar.default.createPackage(this.$.env.paths.electronApp.meteorApp, _path.default.join(this.$.env.paths.electronApp.root, 'meteor.asar')).then(() => {
      // On Windows some files might still be blocked. Giving a tick for them to be
      // ready for deletion.
      setImmediate(() => {
        this.log.verbose('clearing meteor app after packing');
        this.$.utils.rmWithRetries('-rf', this.$.env.paths.electronApp.meteorApp).then(() => {
          resolve();
        }).catch(e => {
          reject(e);
        });
      });
    }));
  }

  /**
   * Wrapper for spawning npm.
   * @param {Array}  commands - commands for spawn
   * @param {string} stdio
   * @param {string} cwd
   * @return {Promise}
   */
  runNpm(commands, stdio = 'ignore', cwd = this.$.env.paths.meteorApp.root) {
    return new Promise((resolve, reject) => {
      this.log.verbose(`executing meteor npm ${commands.join(' ')}`);
      (0, _crossSpawn.default)('meteor', ['npm', ...commands], {
        cwd,
        stdio
      }).on('exit', code => code === 0 ? resolve() : reject(new Error(`npm exit code was ${code}`)));
    });
  }
}
exports.default = MeteorApp;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJfcnVudGltZSIsIl9pbnRlcm9wUmVxdWlyZURlZmF1bHQiLCJyZXF1aXJlIiwiX2ZzIiwiX2Nyb3NzU3Bhd24iLCJfc2VtdmVyIiwiX3NoZWxsanMiLCJfcGF0aCIsIl9zaW5nbGVMaW5lTG9nIiwiX2FzYXIiLCJfbm9kZUZldGNoIiwiX2lzRGVza3RvcEluamVjdG9yIiwiX2xvZyIsIl9tZXRlb3JNYW5hZ2VyIiwiZSIsIl9fZXNNb2R1bGUiLCJkZWZhdWx0Iiwiam9pbiIsInBhdGgiLCJzbGwiLCJzaW5nbGVMaW5lTG9nIiwic3Rkb3V0IiwiTWV0ZW9yQXBwIiwiY29uc3RydWN0b3IiLCIkIiwibG9nIiwiTG9nIiwibWV0ZW9yTWFuYWdlciIsIk1ldGVvck1hbmFnZXIiLCJtb2JpbGVQbGF0Zm9ybSIsIm9sZE1hbmlmZXN0IiwiaW5qZWN0b3IiLCJJc0Rlc2t0b3BJbmplY3RvciIsIm1hdGNoZXIiLCJSZWdFeHAiLCJyZXBsYWNlciIsIm1ldGVvclZlcnNpb24iLCJpbmRleEhUTUxzdHJhdGVneSIsImluZGV4SFRNTFN0cmF0ZWdpZXMiLCJJTkRFWF9GUk9NX0NPUkRPVkFfQlVJTEQiLCJJTkRFWF9GUk9NX1JVTk5JTkdfU0VSVkVSIiwiZGVwcmVjdGF0ZWRQYWNrYWdlcyIsInJlbW92ZURlcHJlY2F0ZWRQYWNrYWdlcyIsImNoZWNrUGFja2FnZXMiLCJpbmZvIiwiZGVsZXRlUGFja2FnZXMiLCJFcnJvciIsImVuc3VyZURlc2t0b3BIQ1BQYWNrYWdlcyIsImRlc2t0b3BIQ1BQYWNrYWdlcyIsImRlc2t0b3AiLCJnZXRTZXR0aW5ncyIsImRlc2t0b3BIQ1AiLCJ2ZXJib3NlIiwicGFja2FnZXNXaXRoVmVyc2lvbiIsIm1hcCIsInBhY2thZ2VOYW1lIiwiZ2V0VmVyc2lvbiIsImVuc3VyZVBhY2thZ2VzIiwidXBkYXRlR2l0SWdub3JlIiwiZ2l0SWdub3JlIiwiZnMiLCJyZWFkRmlsZVN5bmMiLCJlbnYiLCJwYXRocyIsIm1ldGVvckFwcCIsInNwbGl0IiwiZmlsdGVyIiwiaWdub3JlZFBhdGgiLCJ0cmltIiwiaW5kZXhPZiIsImVsZWN0cm9uQXBwIiwicm9vdE5hbWUiLCJwdXNoIiwid3JpdGVGaWxlU3luYyIsImdldE1ldGVvclJlbGVhc2UiLCJyZWxlYXNlIiwicmVwbGFjZSIsImNhc3RNZXRlb3JSZWxlYXNlVG9TZW12ZXIiLCJtYXRjaCIsImNoZWNrTWV0ZW9yVmVyc2lvbiIsInZlcnNpb25SYW5nZSIsInNlbXZlciIsInNhdGlzZmllcyIsIm9wdGlvbnMiLCJza2lwTW9iaWxlQnVpbGQiLCJlcnJvciIsInByb2Nlc3MiLCJleGl0IiwiY2hvb3NlU3RyYXRlZ3kiLCJmb3JjZUNvcmRvdmFCdWlsZCIsImV4cGxvZGVkVmVyc2lvbiIsImxlbmd0aCIsImNoZWNrUHJlY29uZGl0aW9ucyIsImRlYnVnIiwicGxhdGZvcm1zIiwiYW5kcm9pZCIsIndhcm4iLCJhZGRNb2JpbGVQbGF0Zm9ybSIsInBsYXRmb3JtIiwiUHJvbWlzZSIsInJlc29sdmUiLCJyZWplY3QiLCJzcGF3biIsImN3ZCIsInJvb3QiLCJzdGRpbyIsIm9uIiwicmVtb3ZlTW9iaWxlUGxhdGZvcm0iLCJza2lwUmVtb3ZlTW9iaWxlUGxhdGZvcm0iLCJPYmplY3QiLCJhc3NpZ24iLCJNRVRFT1JfUFJFVFRZX09VVFBVVCIsImlzQ29yZG92YUJ1aWxkUmVhZHkiLCJ1dGlscyIsImV4aXN0cyIsImNvcmRvdmFCdWlsZEluZGV4IiwiY29yZG92YUJ1aWxkUHJvZ3JhbUpzb24iLCJ3ZWJDb3Jkb3ZhUHJvZ3JhbUpzb24iLCJhY3F1aXJlSW5kZXgiLCJwb3J0IiwicmVzIiwiZmV0Y2giLCJ0ZXh0IiwiYWNxdWlyZU1hbmlmZXN0IiwiSlNPTiIsInBhcnNlIiwiYnVpbGRNb2JpbGVUYXJnZXQiLCJwcm9ncmFtSnNvbiIsInNlbGYiLCJkZXNpcmVkRXhpdCIsImJ1aWxkVGltZW91dCIsImVycm9yVGltZW91dCIsIm1lc3NhZ2VUaW1lb3V0Iiwia2lsbFRpbWVvdXQiLCJjb3Jkb3ZhQ2hlY2tJbnRlcnZhbCIsInBvcnRQcm9ibGVtIiwid2luZG93c0tpbGwiLCJwaWQiLCJzeW5jIiwib3V0IiwidG9TdHJpbmciLCJhcmdzIiwicHJlcGFyZUFyZ3VtZW50cyIsInJlZ2V4VjEiLCJyZWdleFYyIiwiZm9yRWFjaCIsImxpbmUiLCJleGVjIiwibGFzdEluZGV4Iiwid3JpdGVMb2ciLCJjbGVhclRpbWVvdXRzQW5kSW50ZXJ2YWxzIiwiY2xlYXJJbnRlcnZhbCIsImNsZWFyVGltZW91dCIsIk1FVEVPUl9OT19SRUxFQVNFX0NIRUNLIiwicHJvZERlYnVnIiwiTUVURU9SX0RFU0tPUF9QUk9EX0RFQlVHIiwiY2hpbGQiLCJzaGVsbCIsImtpbGwiLCJzaWduYWwiLCJvcyIsImlzV2luZG93cyIsInNldFRpbWVvdXQiLCJjb3B5QnVpbGQiLCJ0aGVuIiwiY2F0Y2giLCJzZXRJbnRlcnZhbCIsInN0ZGVyciIsImNodW5rIiwiQXJyYXkiLCJpc0FycmF5IiwiaWdub3JlU3RkZXJyIiwiZXZlcnkiLCJzdHIiLCJsaW5lc1RvRGlzcGxheSIsInNhbml0aXplZExpbmUiLCJwb3AiLCJ1cGRhdGVEZHBVcmwiLCJpbmRleEh0bWwiLCJjb250ZW50IiwicnVudGltZUNvbmZpZyIsIm1lc3NhZ2UiLCJ0ZXN0IiwibWF0Y2hlcyIsImRlY29kZVVSSUNvbXBvbmVudCIsImRkcFVybCIsInN1YnN0ciIsIlJPT1RfVVJMIiwiRERQX0RFRkFVTFRfQ09OTkVDVElPTl9VUkwiLCJlbmNvZGVVUklDb21wb25lbnQiLCJzdHJpbmdpZnkiLCJpc1Byb2R1Y3Rpb25CdWlsZCIsIm1ldGVvclNldHRpbmdzIiwicm1XaXRoUmV0cmllcyIsInByZWZpeCIsImNvcHlQYXRoUG9zdGZpeCIsInNlcCIsIm1rZGlyU3luYyIsIm1ldGVvckFwcEluZGV4IiwiY29yZG92YUJ1aWxkIiwiY3AiLCJjaG1vZCIsIm1ldGVvckFwcFByb2dyYW1Kc29uIiwiX19kaXJuYW1lIiwiaW5qZWN0SXNEZXNrdG9wIiwibWFuaWZlc3RKc29uUGF0aCIsIm1hbmlmZXN0IiwiaW5qZWN0ZWQiLCJpbmplY3RlZFN0YXJ0dXBEaWRDb21wbGV0ZSIsInJlc3VsdCIsImZpbGUiLCJmaWxlQ29udGVudHMiLCJ0eXBlIiwicHJvY2Vzc0ZpbGVDb250ZW50cyIsImJ1aWxkIiwicmVhc29uIiwiY2hhbmdlRGRwVXJsIiwicGFja1RvQXNhciIsImFzYXIiLCJjcmVhdGVQYWNrYWdlIiwic2V0SW1tZWRpYXRlIiwicnVuTnBtIiwiY29tbWFuZHMiLCJjb2RlIiwiZXhwb3J0cyJdLCJzb3VyY2VzIjpbIi4uL2xpYi9tZXRlb3JBcHAuanMiXSwic291cmNlc0NvbnRlbnQiOlsiLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIG5vLXVudXNlZC12YXJzXG5pbXBvcnQgcmVnZW5lcmF0b3JSdW50aW1lIGZyb20gJ3JlZ2VuZXJhdG9yLXJ1bnRpbWUvcnVudGltZSc7XG5pbXBvcnQgZnMgZnJvbSAnZnMnO1xuaW1wb3J0IHNwYXduIGZyb20gJ2Nyb3NzLXNwYXduJztcbmltcG9ydCBzZW12ZXIgZnJvbSAnc2VtdmVyJztcbmltcG9ydCBzaGVsbCBmcm9tICdzaGVsbGpzJztcbmltcG9ydCBwYXRoIGZyb20gJ3BhdGgnO1xuaW1wb3J0IHNpbmdsZUxpbmVMb2cgZnJvbSAnc2luZ2xlLWxpbmUtbG9nJztcbmltcG9ydCBhc2FyIGZyb20gJ0BlbGVjdHJvbi9hc2FyJztcbmltcG9ydCBmZXRjaCBmcm9tICdub2RlLWZldGNoJztcblxuaW1wb3J0IElzRGVza3RvcEluamVjdG9yIGZyb20gJy4uL3NrZWxldG9uL21vZHVsZXMvYXV0b3VwZGF0ZS9pc0Rlc2t0b3BJbmplY3Rvcic7XG5pbXBvcnQgTG9nIGZyb20gJy4vbG9nJztcbmltcG9ydCBNZXRlb3JNYW5hZ2VyIGZyb20gJy4vbWV0ZW9yTWFuYWdlcic7XG5cbmNvbnN0IHsgam9pbiB9ID0gcGF0aDtcbmNvbnN0IHNsbCA9IHNpbmdsZUxpbmVMb2cuc3Rkb3V0O1xuXG4vLyBUT0RPOiByZWZhY3RvciBhbGwgc3RyYXRlZ3kgaWZzIHRvIG9uZSBwbGFjZVxuXG4vKipcbiAqIFJlcHJlc2VudHMgdGhlIE1ldGVvciBhcHAuXG4gKiBAcHJvcGVydHkge01ldGVvckRlc2t0b3B9ICRcbiAqIEBjbGFzc1xuICovXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBNZXRlb3JBcHAge1xuICAgIC8qKlxuICAgICAqIEBwYXJhbSB7TWV0ZW9yRGVza3RvcH0gJCAtIGNvbnRleHRcbiAgICAgKiBAY29uc3RydWN0b3JcbiAgICAgKi9cbiAgICBjb25zdHJ1Y3RvcigkKSB7XG4gICAgICAgIHRoaXMubG9nID0gbmV3IExvZygnbWV0ZW9yQXBwJyk7XG4gICAgICAgIHRoaXMuJCA9ICQ7XG4gICAgICAgIHRoaXMubWV0ZW9yTWFuYWdlciA9IG5ldyBNZXRlb3JNYW5hZ2VyKCQpO1xuICAgICAgICB0aGlzLm1vYmlsZVBsYXRmb3JtID0gbnVsbDtcbiAgICAgICAgdGhpcy5vbGRNYW5pZmVzdCA9IG51bGw7XG4gICAgICAgIHRoaXMuaW5qZWN0b3IgPSBuZXcgSXNEZXNrdG9wSW5qZWN0b3IoKTtcbiAgICAgICAgdGhpcy5tYXRjaGVyID0gbmV3IFJlZ0V4cChcbiAgICAgICAgICAgICdfX21ldGVvcl9ydW50aW1lX2NvbmZpZ19fID0gSlNPTi5wYXJzZVxcXFwoZGVjb2RlVVJJQ29tcG9uZW50XFxcXChcIihbXlwiXSopXCJcXFxcKVxcXFwpJ1xuICAgICAgICApO1xuICAgICAgICB0aGlzLnJlcGxhY2VyID0gbmV3IFJlZ0V4cChcbiAgICAgICAgICAgICcoX19tZXRlb3JfcnVudGltZV9jb25maWdfXyA9IEpTT04ucGFyc2VcXFxcKGRlY29kZVVSSUNvbXBvbmVudFxcXFwoKVwiKFteXCJdKilcIihcXFxcKVxcXFwpKSdcbiAgICAgICAgKTtcbiAgICAgICAgdGhpcy5tZXRlb3JWZXJzaW9uID0gbnVsbDtcbiAgICAgICAgdGhpcy5pbmRleEhUTUxzdHJhdGVneSA9IG51bGw7XG5cbiAgICAgICAgdGhpcy5pbmRleEhUTUxTdHJhdGVnaWVzID0ge1xuICAgICAgICAgICAgSU5ERVhfRlJPTV9DT1JET1ZBX0JVSUxEOiAxLFxuICAgICAgICAgICAgSU5ERVhfRlJPTV9SVU5OSU5HX1NFUlZFUjogMlxuICAgICAgICB9O1xuXG4gICAgICAgIHRoaXMuZGVwcmVjdGF0ZWRQYWNrYWdlcyA9IFsnb21lZ2E6bWV0ZW9yLWRlc2t0b3AtbG9jYWxzdG9yYWdlJ107XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogUmVtb3ZlIGFueSBkZXByZWNhdGVkIHBhY2thZ2VzIGZyb20gbWV0ZW9yIHByb2plY3QuXG4gICAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gICAgICovXG4gICAgYXN5bmMgcmVtb3ZlRGVwcmVjYXRlZFBhY2thZ2VzKCkge1xuICAgICAgICB0cnkge1xuICAgICAgICAgICAgaWYgKHRoaXMubWV0ZW9yTWFuYWdlci5jaGVja1BhY2thZ2VzKHRoaXMuZGVwcmVjdGF0ZWRQYWNrYWdlcykpIHtcbiAgICAgICAgICAgICAgICB0aGlzLmxvZy5pbmZvKCdkZXByZWNhdGVkIG1ldGVvciBwbHVnaW5zIGZvdW5kLCByZW1vdmluZyB0aGVtJyk7XG4gICAgICAgICAgICAgICAgYXdhaXQgdGhpcy5tZXRlb3JNYW5hZ2VyLmRlbGV0ZVBhY2thZ2VzKHRoaXMuZGVwcmVjdGF0ZWRQYWNrYWdlcyk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihlKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIC8qKlxuICAgICAqIEVuc3VyZXMgdGhhdCByZXF1aXJlZCBwYWNrYWdlcyBhcmUgYWRkZWQgdG8gdGhlIE1ldGVvciBhcHAuXG4gICAgICovXG4gICAgYXN5bmMgZW5zdXJlRGVza3RvcEhDUFBhY2thZ2VzKCkge1xuICAgICAgICBjb25zdCBkZXNrdG9wSENQUGFja2FnZXMgPSBbJ2NvbW11bml0eXBhY2thZ2VzOm1ldGVvci1kZXNrdG9wLXdhdGNoZXInLCAnY29tbXVuaXR5cGFja2FnZXM6bWV0ZW9yLWRlc2t0b3AtYnVuZGxlciddO1xuICAgICAgICBpZiAodGhpcy4kLmRlc2t0b3AuZ2V0U2V0dGluZ3MoKS5kZXNrdG9wSENQKSB7XG4gICAgICAgICAgICB0aGlzLmxvZy52ZXJib3NlKCdkZXNrdG9wSENQIGlzIGVuYWJsZWQsIGNoZWNraW5nIGZvciByZXF1aXJlZCBwYWNrYWdlcycpO1xuXG4gICAgICAgICAgICBjb25zdCBwYWNrYWdlc1dpdGhWZXJzaW9uID0gZGVza3RvcEhDUFBhY2thZ2VzLm1hcChwYWNrYWdlTmFtZSA9PiBgJHtwYWNrYWdlTmFtZX1AJHt0aGlzLiQuZ2V0VmVyc2lvbigpfWApO1xuXG4gICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgIGF3YWl0IHRoaXMubWV0ZW9yTWFuYWdlci5lbnN1cmVQYWNrYWdlcyhkZXNrdG9wSENQUGFja2FnZXMsIHBhY2thZ2VzV2l0aFZlcnNpb24sICdkZXNrdG9wSENQJyk7XG4gICAgICAgICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGUpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgdGhpcy5sb2cudmVyYm9zZSgnZGVza3RvcEhDUCBpcyBub3QgZW5hYmxlZCwgcmVtb3ZpbmcgcmVxdWlyZWQgcGFja2FnZXMnKTtcblxuICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICBpZiAodGhpcy5tZXRlb3JNYW5hZ2VyLmNoZWNrUGFja2FnZXMoZGVza3RvcEhDUFBhY2thZ2VzKSkge1xuICAgICAgICAgICAgICAgICAgICBhd2FpdCB0aGlzLm1ldGVvck1hbmFnZXIuZGVsZXRlUGFja2FnZXMoZGVza3RvcEhDUFBhY2thZ2VzKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGUpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogQWRkcyBlbnRyeSB0byAubWV0ZW9yLy5naXRpZ25vcmUgaWYgbmVjZXNzYXJ5LlxuICAgICAqL1xuICAgIHVwZGF0ZUdpdElnbm9yZSgpIHtcbiAgICAgICAgdGhpcy5sb2cudmVyYm9zZSgndXBkYXRpbmcgLm1ldGVvci8uZ2l0aWdub3JlJyk7XG4gICAgICAgIC8vIExldHMgcmVhZCB0aGUgLm1ldGVvci8uZ2l0aWdub3JlIGFuZCBmaWx0ZXIgb3V0IGJsYW5rIGxpbmVzLlxuICAgICAgICBjb25zdCBnaXRJZ25vcmUgPSBmcy5yZWFkRmlsZVN5bmModGhpcy4kLmVudi5wYXRocy5tZXRlb3JBcHAuZ2l0SWdub3JlLCAnVVRGLTgnKVxuICAgICAgICAgICAgLnNwbGl0KCdcXG4nKS5maWx0ZXIoaWdub3JlZFBhdGggPT4gaWdub3JlZFBhdGgudHJpbSgpICE9PSAnJyk7XG5cbiAgICAgICAgaWYgKCF+Z2l0SWdub3JlLmluZGV4T2YodGhpcy4kLmVudi5wYXRocy5lbGVjdHJvbkFwcC5yb290TmFtZSkpIHtcbiAgICAgICAgICAgIHRoaXMubG9nLnZlcmJvc2UoYGFkZGluZyAke3RoaXMuJC5lbnYucGF0aHMuZWxlY3Ryb25BcHAucm9vdE5hbWV9IHRvIC5tZXRlb3IvLmdpdGlnbm9yZWApO1xuICAgICAgICAgICAgZ2l0SWdub3JlLnB1c2godGhpcy4kLmVudi5wYXRocy5lbGVjdHJvbkFwcC5yb290TmFtZSk7XG5cbiAgICAgICAgICAgIGZzLndyaXRlRmlsZVN5bmModGhpcy4kLmVudi5wYXRocy5tZXRlb3JBcHAuZ2l0SWdub3JlLCBnaXRJZ25vcmUuam9pbignXFxuJyksICdVVEYtOCcpO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogUmVhZHMgdGhlIE1ldGVvciByZWxlYXNlIHZlcnNpb24gdXNlZCBpbiB0aGUgYXBwLlxuICAgICAqIEByZXR1cm5zIHtzdHJpbmd9XG4gICAgICovXG4gICAgZ2V0TWV0ZW9yUmVsZWFzZSgpIHtcbiAgICAgICAgbGV0IHJlbGVhc2UgPSBmcy5yZWFkRmlsZVN5bmModGhpcy4kLmVudi5wYXRocy5tZXRlb3JBcHAucmVsZWFzZSwgJ1VURi04JylcbiAgICAgICAgICAgIC5yZXBsYWNlKC9cXHIvZ20sICcnKVxuICAgICAgICAgICAgLnNwbGl0KCdcXG4nKVswXTtcbiAgICAgICAgKFssIHJlbGVhc2VdID0gcmVsZWFzZS5zcGxpdCgnQCcpKTtcbiAgICAgICAgLy8gV2UgZG8gbm90IGNhcmUgaWYgaXQgaXMgYmV0YS5cbiAgICAgICAgaWYgKH5yZWxlYXNlLmluZGV4T2YoJy0nKSkge1xuICAgICAgICAgICAgKFtyZWxlYXNlXSA9IHJlbGVhc2Uuc3BsaXQoJy0nKSk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHJlbGVhc2U7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogQ2FzdCBNZXRlb3IgcmVsZWFzZSB0byBzZW12ZXIgdmVyc2lvbi5cbiAgICAgKiBAcmV0dXJucyB7c3RyaW5nfVxuICAgICAqL1xuICAgIGNhc3RNZXRlb3JSZWxlYXNlVG9TZW12ZXIoKSB7XG4gICAgICAgIHJldHVybiBgJHt0aGlzLmdldE1ldGVvclJlbGVhc2UoKX0uMC4wYC5tYXRjaCgvKF5cXGQrXFwuXFxkK1xcLlxcZCspL2dtaSlbMF07XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogVmFsaWRhdGUgbWV0ZW9yIHZlcnNpb24gYWdhaW5zdCBhIHZlcnNpb25SYW5nZS5cbiAgICAgKiBAcGFyYW0ge3N0cmluZ30gdmVyc2lvblJhbmdlIC0gc2VtdmVyIHZlcnNpb24gcmFuZ2VcbiAgICAgKi9cbiAgICBjaGVja01ldGVvclZlcnNpb24odmVyc2lvblJhbmdlKSB7XG4gICAgICAgIGNvbnN0IHJlbGVhc2UgPSB0aGlzLmNhc3RNZXRlb3JSZWxlYXNlVG9TZW12ZXIoKTtcbiAgICAgICAgaWYgKCFzZW12ZXIuc2F0aXNmaWVzKHJlbGVhc2UsIHZlcnNpb25SYW5nZSkpIHtcbiAgICAgICAgICAgIGlmICh0aGlzLiQuZW52Lm9wdGlvbnMuc2tpcE1vYmlsZUJ1aWxkKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5sb2cuZXJyb3IoYHdyb25nIG1ldGVvciB2ZXJzaW9uICgke3JlbGVhc2V9KSBpbiBwcm9qZWN0IC0gb25seSBgICtcbiAgICAgICAgICAgICAgICAgICAgYCR7dmVyc2lvblJhbmdlfSBpcyBzdXBwb3J0ZWRgKTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgdGhpcy5sb2cuZXJyb3IoYHdyb25nIG1ldGVvciB2ZXJzaW9uICgke3JlbGVhc2V9KSBpbiBwcm9qZWN0IC0gb25seSBgICtcbiAgICAgICAgICAgICAgICAgICAgYCR7dmVyc2lvblJhbmdlfSBpcyBzdXBwb3J0ZWQgZm9yIGF1dG9tYXRpYyBtZXRlb3IgYnVpbGRzICh5b3UgY2FuIGFsd2F5cyBgICtcbiAgICAgICAgICAgICAgICAgICAgJ3RyeSB3aXRoIGAtLXNraXAtbW9iaWxlLWJ1aWxkYCBpZiB5b3UgYXJlIHVzaW5nIG1ldGVvciA+PSAxLjIuMScpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcHJvY2Vzcy5leGl0KDEpO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogRGVjaWRlcyB3aGljaCBzdHJhdGVneSB0byB1c2Ugd2hpbGUgdHJ5aW5nIHRvIGdldCBjbGllbnQgYnVpbGQgb3V0IG9mIE1ldGVvciBwcm9qZWN0LlxuICAgICAqIEByZXR1cm5zIHtudW1iZXJ9XG4gICAgICovXG4gICAgY2hvb3NlU3RyYXRlZ3koKSB7XG4gICAgICAgIGlmICh0aGlzLiQuZW52Lm9wdGlvbnMuZm9yY2VDb3Jkb3ZhQnVpbGQpIHtcbiAgICAgICAgICAgIHJldHVybiB0aGlzLmluZGV4SFRNTFN0cmF0ZWdpZXMuSU5ERVhfRlJPTV9DT1JET1ZBX0JVSUxEO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgcmVsZWFzZSA9IHRoaXMuY2FzdE1ldGVvclJlbGVhc2VUb1NlbXZlcigpO1xuICAgICAgICBpZiAoc2VtdmVyLnNhdGlzZmllcyhyZWxlYXNlLCAnPiAxLjMuNCcpKSB7XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5pbmRleEhUTUxTdHJhdGVnaWVzLklOREVYX0ZST01fUlVOTklOR19TRVJWRVI7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHNlbXZlci5zYXRpc2ZpZXMocmVsZWFzZSwgJzEuMy40JykpIHtcbiAgICAgICAgICAgIGNvbnN0IGV4cGxvZGVkVmVyc2lvbiA9IHRoaXMuZ2V0TWV0ZW9yUmVsZWFzZSgpLnNwbGl0KCcuJyk7XG4gICAgICAgICAgICBpZiAoZXhwbG9kZWRWZXJzaW9uLmxlbmd0aCA+PSA0KSB7XG4gICAgICAgICAgICAgICAgaWYgKGV4cGxvZGVkVmVyc2lvblszXSA+IDEpIHtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHRoaXMuaW5kZXhIVE1MU3RyYXRlZ2llcy5JTkRFWF9GUk9NX1JVTk5JTkdfU0VSVkVSO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICByZXR1cm4gdGhpcy5pbmRleEhUTUxTdHJhdGVnaWVzLklOREVYX0ZST01fQ09SRE9WQV9CVUlMRDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gdGhpcy5pbmRleEhUTUxTdHJhdGVnaWVzLklOREVYX0ZST01fQ09SRE9WQV9CVUlMRDtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBDaGVja3MgcmVxdWlyZWQgcHJlY29uZGl0aW9ucy5cbiAgICAgKiAtIE1ldGVvciB2ZXJzaW9uXG4gICAgICogLSBpcyBtb2JpbGUgcGxhdGZvcm0gYWRkZWRcbiAgICAgKi9cbiAgICBhc3luYyBjaGVja1ByZWNvbmRpdGlvbnMoKSB7XG4gICAgICAgIGlmICh0aGlzLiQuZW52Lm9wdGlvbnMuc2tpcE1vYmlsZUJ1aWxkKSB7XG4gICAgICAgICAgICB0aGlzLmNoZWNrTWV0ZW9yVmVyc2lvbignPj0gMS4yLjEnKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHRoaXMuY2hlY2tNZXRlb3JWZXJzaW9uKCc+PSAxLjMuMycpO1xuICAgICAgICAgICAgdGhpcy5pbmRleEhUTUxzdHJhdGVneSA9IHRoaXMuY2hvb3NlU3RyYXRlZ3koKTtcbiAgICAgICAgICAgIGlmICh0aGlzLmluZGV4SFRNTHN0cmF0ZWd5ID09PSB0aGlzLmluZGV4SFRNTFN0cmF0ZWdpZXMuSU5ERVhfRlJPTV9DT1JET1ZBX0JVSUxEKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5sb2cuZGVidWcoXG4gICAgICAgICAgICAgICAgICAgICdtZXRlb3IgdmVyc2lvbiBpcyA8IDEuMy40LjIgc28gdGhlIGluZGV4Lmh0bWwgZnJvbSBjb3Jkb3ZhLWJ1aWxkIHdpbGwnICtcbiAgICAgICAgICAgICAgICAgICAgJyBiZSB1c2VkJ1xuICAgICAgICAgICAgICAgICk7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIHRoaXMubG9nLmRlYnVnKFxuICAgICAgICAgICAgICAgICAgICAnbWV0ZW9yIHZlcnNpb24gaXMgPj0gMS4zLjQuMiBzbyB0aGUgaW5kZXguaHRtbCB3aWxsIGJlIGRvd25sb2FkZWQgJyArXG4gICAgICAgICAgICAgICAgICAgICdmcm9tIF9fY29yZG92YS9pbmRleC5odG1sJ1xuICAgICAgICAgICAgICAgICk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoIXRoaXMuJC5lbnYub3B0aW9ucy5za2lwTW9iaWxlQnVpbGQpIHtcbiAgICAgICAgICAgIGNvbnN0IHBsYXRmb3JtcyA9IGZzLnJlYWRGaWxlU3luYyh0aGlzLiQuZW52LnBhdGhzLm1ldGVvckFwcC5wbGF0Zm9ybXMsICdVVEYtOCcpO1xuICAgICAgICAgICAgaWYgKCF+cGxhdGZvcm1zLmluZGV4T2YoJ2FuZHJvaWQnKSAmJiAhfnBsYXRmb3Jtcy5pbmRleE9mKCdpb3MnKSkge1xuICAgICAgICAgICAgICAgIGlmICghdGhpcy4kLmVudi5vcHRpb25zLmFuZHJvaWQpIHtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5tb2JpbGVQbGF0Zm9ybSA9ICdpb3MnO1xuICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMubW9iaWxlUGxhdGZvcm0gPSAnYW5kcm9pZCc7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIHRoaXMubG9nLndhcm4oYG5vIG1vYmlsZSB0YXJnZXQgZGV0ZWN0ZWQgLSB3aWxsIGFkZCAnJHt0aGlzLm1vYmlsZVBsYXRmb3JtfScgYCArXG4gICAgICAgICAgICAgICAgICAgICdqdXN0IHRvIGdldCBhIG1vYmlsZSBidWlsZCcpO1xuICAgICAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgICAgIGF3YWl0IHRoaXMuYWRkTW9iaWxlUGxhdGZvcm0odGhpcy5tb2JpbGVQbGF0Zm9ybSk7XG4gICAgICAgICAgICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICAgICAgICAgICAgICB0aGlzLmxvZy5lcnJvcignZmFpbGVkIHRvIGFkZCBhIG1vYmlsZSBwbGF0Zm9ybSAtIHBsZWFzZSB0cnkgdG8gZG8gaXQgbWFudWFsbHknKTtcbiAgICAgICAgICAgICAgICAgICAgcHJvY2Vzcy5leGl0KDEpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cblxuICAgIC8qKlxuICAgICAqIFRyaWVzIHRvIGFkZCBhIG1vYmlsZSBwbGF0Zm9ybSB0byBtZXRlb3IgcHJvamVjdC5cbiAgICAgKiBAcGFyYW0ge3N0cmluZ30gcGxhdGZvcm0gLSBwbGF0Zm9ybSB0byBhZGRcbiAgICAgKiBAcmV0dXJucyB7UHJvbWlzZX1cbiAgICAgKi9cbiAgICBhZGRNb2JpbGVQbGF0Zm9ybShwbGF0Zm9ybSkge1xuICAgICAgICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgICAgICAgICAgdGhpcy5sb2cudmVyYm9zZShgYWRkaW5nIG1vYmlsZSBwbGF0Zm9ybTogJHtwbGF0Zm9ybX1gKTtcbiAgICAgICAgICAgIHNwYXduKCdtZXRlb3InLCBbJ2FkZC1wbGF0Zm9ybScsIHBsYXRmb3JtXSwge1xuICAgICAgICAgICAgICAgIGN3ZDogdGhpcy4kLmVudi5wYXRocy5tZXRlb3JBcHAucm9vdCxcbiAgICAgICAgICAgICAgICBzdGRpbzogdGhpcy4kLmVudi5zdGRpb1xuICAgICAgICAgICAgfSkub24oJ2V4aXQnLCAoKSA9PiB7XG4gICAgICAgICAgICAgICAgY29uc3QgcGxhdGZvcm1zID0gZnMucmVhZEZpbGVTeW5jKHRoaXMuJC5lbnYucGF0aHMubWV0ZW9yQXBwLnBsYXRmb3JtcywgJ1VURi04Jyk7XG4gICAgICAgICAgICAgICAgaWYgKCF+cGxhdGZvcm1zLmluZGV4T2YoJ2FuZHJvaWQnKSAmJiAhfnBsYXRmb3Jtcy5pbmRleE9mKCdpb3MnKSkge1xuICAgICAgICAgICAgICAgICAgICByZWplY3QoKTtcbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICByZXNvbHZlKCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIFRyaWVzIHRvIHJlbW92ZSBhIG1vYmlsZSBwbGF0Zm9ybSBmcm9tIG1ldGVvciBwcm9qZWN0LlxuICAgICAqIEBwYXJhbSB7c3RyaW5nfSBwbGF0Zm9ybSAtIHBsYXRmb3JtIHRvIHJlbW92ZVxuICAgICAqIEByZXR1cm5zIHtQcm9taXNlfVxuICAgICAqL1xuICAgIHJlbW92ZU1vYmlsZVBsYXRmb3JtKHBsYXRmb3JtKSB7XG4gICAgICAgIGlmICh0aGlzLiQuZW52Lm9wdGlvbnMuc2tpcFJlbW92ZU1vYmlsZVBsYXRmb3JtKSB7XG4gICAgICAgICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgICAgICAgIHRoaXMubG9nLnZlcmJvc2UoYHJlbW92aW5nIG1vYmlsZSBwbGF0Zm9ybTogJHtwbGF0Zm9ybX1gKTtcbiAgICAgICAgICAgIHNwYXduKCdtZXRlb3InLCBbJ3JlbW92ZS1wbGF0Zm9ybScsIHBsYXRmb3JtXSwge1xuICAgICAgICAgICAgICAgIGN3ZDogdGhpcy4kLmVudi5wYXRocy5tZXRlb3JBcHAucm9vdCxcbiAgICAgICAgICAgICAgICBzdGRpbzogdGhpcy4kLmVudi5zdGRpbyxcbiAgICAgICAgICAgICAgICBlbnY6IE9iamVjdC5hc3NpZ24oeyBNRVRFT1JfUFJFVFRZX09VVFBVVDogMCB9LCBwcm9jZXNzLmVudilcbiAgICAgICAgICAgIH0pLm9uKCdleGl0JywgKCkgPT4ge1xuICAgICAgICAgICAgICAgIGNvbnN0IHBsYXRmb3JtcyA9IGZzLnJlYWRGaWxlU3luYyh0aGlzLiQuZW52LnBhdGhzLm1ldGVvckFwcC5wbGF0Zm9ybXMsICdVVEYtOCcpO1xuICAgICAgICAgICAgICAgIGlmICh+cGxhdGZvcm1zLmluZGV4T2YocGxhdGZvcm0pKSB7XG4gICAgICAgICAgICAgICAgICAgIHJlamVjdCgpO1xuICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgIHJlc29sdmUoKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogSnVzdCBjaGVja3MgZm9yIGluZGV4Lmh0bWwgYW5kIHByb2dyYW0uanNvbiBleGlzdGVuY2UuXG4gICAgICogQHJldHVybnMge2Jvb2xlYW59XG4gICAgICovXG4gICAgaXNDb3Jkb3ZhQnVpbGRSZWFkeSgpIHtcbiAgICAgICAgaWYgKHRoaXMuaW5kZXhIVE1Mc3RyYXRlZ3kgPT09IHRoaXMuaW5kZXhIVE1MU3RyYXRlZ2llcy5JTkRFWF9GUk9NX0NPUkRPVkFfQlVJTEQpIHtcbiAgICAgICAgICAgIHJldHVybiB0aGlzLiQudXRpbHMuZXhpc3RzKHRoaXMuJC5lbnYucGF0aHMubWV0ZW9yQXBwLmNvcmRvdmFCdWlsZEluZGV4KSAmJlxuICAgICAgICAgICAgICAgIHRoaXMuJC51dGlscy5leGlzdHModGhpcy4kLmVudi5wYXRocy5tZXRlb3JBcHAuY29yZG92YUJ1aWxkUHJvZ3JhbUpzb24pICYmXG4gICAgICAgICAgICAgICAgKFxuICAgICAgICAgICAgICAgICAgICAhdGhpcy5vbGRNYW5pZmVzdCB8fFxuICAgICAgICAgICAgICAgICAgICAodGhpcy5vbGRNYW5pZmVzdCAmJlxuICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5vbGRNYW5pZmVzdCAhPT0gZnMucmVhZEZpbGVTeW5jKFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuJC5lbnYucGF0aHMubWV0ZW9yQXBwLmNvcmRvdmFCdWlsZFByb2dyYW1Kc29uLCAnVVRGLTgnXG4gICAgICAgICAgICAgICAgICAgICAgICApXG4gICAgICAgICAgICAgICAgICAgIClcbiAgICAgICAgICAgICAgICApO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiB0aGlzLiQudXRpbHMuZXhpc3RzKHRoaXMuJC5lbnYucGF0aHMubWV0ZW9yQXBwLndlYkNvcmRvdmFQcm9ncmFtSnNvbikgJiZcbiAgICAgICAgICAgIChcbiAgICAgICAgICAgICAgICAhdGhpcy5vbGRNYW5pZmVzdCB8fFxuICAgICAgICAgICAgICAgICh0aGlzLm9sZE1hbmlmZXN0ICYmXG4gICAgICAgICAgICAgICAgICAgIHRoaXMub2xkTWFuaWZlc3QgIT09IGZzLnJlYWRGaWxlU3luYyhcbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuJC5lbnYucGF0aHMubWV0ZW9yQXBwLndlYkNvcmRvdmFQcm9ncmFtSnNvbiwgJ1VURi04J1xuICAgICAgICAgICAgICAgICAgICApXG4gICAgICAgICAgICAgICAgKVxuICAgICAgICAgICAgKTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBGZXRjaGVzIGluZGV4Lmh0bWwgZnJvbSBydW5uaW5nIHByb2plY3QuXG4gICAgICogQHJldHVybnMge1Byb21pc2UuPCo+fVxuICAgICAqL1xuICAgIGFzeW5jIGFjcXVpcmVJbmRleCgpIHtcbiAgICAgICAgY29uc3QgcG9ydCA9ICh0aGlzLiQuZW52Lm9wdGlvbnMucG9ydCkgPyB0aGlzLiQuZW52Lm9wdGlvbnMucG9ydCA6IDMwODA7XG4gICAgICAgIHRoaXMubG9nLmluZm8oJ2FjcXVpcmluZyBpbmRleC5odG1sJyk7XG4gICAgICAgIGNvbnN0IHJlcyA9IGF3YWl0IGZldGNoKGBodHRwOi8vMTI3LjAuMC4xOiR7cG9ydH0vX19jb3Jkb3ZhL2luZGV4Lmh0bWxgKTtcbiAgICAgICAgY29uc3QgdGV4dCA9IGF3YWl0IHJlcy50ZXh0KCk7XG4gICAgICAgIC8vIFNpbXBsZSB0ZXN0IGlmIHdlIHJlYWxseSBkb3dubG9hZCBpbmRleC5odG1sIGZvciB3ZWIuY29yZG92YS5cbiAgICAgICAgaWYgKH50ZXh0LmluZGV4T2YoJ3NyYz1cIi9jb3Jkb3ZhLmpzXCInKSkge1xuICAgICAgICAgICAgcmV0dXJuIHRleHQ7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIEZldGNoZXMgbWFpbmZlc3QuanNvbiBmcm9tIHJ1bm5pbmcgcHJvamVjdC5cbiAgICAgKiBAcmV0dXJucyB7UHJvbWlzZS48dm9pZD59XG4gICAgICovXG4gICAgYXN5bmMgYWNxdWlyZU1hbmlmZXN0KCkge1xuICAgICAgICBjb25zdCBwb3J0ID0gKHRoaXMuJC5lbnYub3B0aW9ucy5wb3J0KSA/IHRoaXMuJC5lbnYub3B0aW9ucy5wb3J0IDogMzA4MDtcbiAgICAgICAgdGhpcy5sb2cuaW5mbygnYWNxdWlyaW5nIG1hbmlmZXN0Lmpzb24nKTtcbiAgICAgICAgY29uc3QgcmVzID0gYXdhaXQgZmV0Y2goXG4gICAgICAgICAgICBgaHR0cDovLzEyNy4wLjAuMToke3BvcnR9L19fY29yZG92YS9tYW5pZmVzdC5qc29uP21ldGVvcl9kb250X3NlcnZlX2luZGV4PXRydWVgXG4gICAgICAgICk7XG4gICAgICAgIGNvbnN0IHRleHQgPSBhd2FpdCByZXMudGV4dCgpO1xuICAgICAgICByZXR1cm4gSlNPTi5wYXJzZSh0ZXh0KTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBUcmllcyB0byBnZXQgYSBtb2JpbGUgYnVpbGQgZnJvbSBtZXRlb3IgYXBwLlxuICAgICAqIEluIGNhc2Ugb2YgZmFpbHVyZSBsZWF2ZXMgYSBtZXRlb3IubG9nLlxuICAgICAqIEEgbG90IG9mIHN0dWZmIGlzIGhhcHBlbmluZyBoZXJlIC0gYnV0IHRoZSBtYWluIGFpbSBpcyB0byBnZXQgYSBtb2JpbGUgYnVpbGQgZnJvbVxuICAgICAqIC5tZXRlb3IvbG9jYWwvY29yZG92YS1idWlsZC93d3cvYXBwbGljYXRpb24gYW5kIGV4aXQgYXMgc29vbiBhcyBwb3NzaWJsZS5cbiAgICAgKlxuICAgICAqIEByZXR1cm5zIHtQcm9taXNlfVxuICAgICAqL1xuICAgIGJ1aWxkTW9iaWxlVGFyZ2V0KCkge1xuICAgICAgICBjb25zdCBwcm9ncmFtSnNvbiA9XG4gICAgICAgICAgICAodGhpcy5pbmRleEhUTUxzdHJhdGVneSA9PT0gdGhpcy5pbmRleEhUTUxTdHJhdGVnaWVzLklOREVYX0ZST01fQ09SRE9WQV9CVUlMRCkgP1xuICAgICAgICAgICAgICAgIHRoaXMuJC5lbnYucGF0aHMubWV0ZW9yQXBwLmNvcmRvdmFCdWlsZFByb2dyYW1Kc29uIDpcbiAgICAgICAgICAgICAgICB0aGlzLiQuZW52LnBhdGhzLm1ldGVvckFwcC53ZWJDb3Jkb3ZhUHJvZ3JhbUpzb247XG5cbiAgICAgICAgaWYgKHRoaXMuJC51dGlscy5leGlzdHMocHJvZ3JhbUpzb24pKSB7XG4gICAgICAgICAgICB0aGlzLm9sZE1hbmlmZXN0ID0gZnMucmVhZEZpbGVTeW5jKHByb2dyYW1Kc29uLCAnVVRGLTgnKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICAgICAgICBjb25zdCBzZWxmID0gdGhpcztcbiAgICAgICAgICAgIGxldCBsb2cgPSAnJztcbiAgICAgICAgICAgIGxldCBkZXNpcmVkRXhpdCA9IGZhbHNlO1xuICAgICAgICAgICAgbGV0IGJ1aWxkVGltZW91dCA9IG51bGw7XG4gICAgICAgICAgICBsZXQgZXJyb3JUaW1lb3V0ID0gbnVsbDtcbiAgICAgICAgICAgIGxldCBtZXNzYWdlVGltZW91dCA9IG51bGw7XG4gICAgICAgICAgICBsZXQga2lsbFRpbWVvdXQgPSBudWxsO1xuICAgICAgICAgICAgbGV0IGNvcmRvdmFDaGVja0ludGVydmFsID0gbnVsbDtcbiAgICAgICAgICAgIGxldCBwb3J0UHJvYmxlbSA9IGZhbHNlO1xuXG4gICAgICAgICAgICBmdW5jdGlvbiB3aW5kb3dzS2lsbChwaWQpIHtcbiAgICAgICAgICAgICAgICBzZWxmLmxvZy5kZWJ1Zyhga2lsbGluZyBwaWQ6ICR7cGlkfWApO1xuICAgICAgICAgICAgICAgIHNwYXduLnN5bmMoJ3Rhc2traWxsJywgWycvcGlkJywgcGlkLCAnL2YnLCAnL3QnXSk7XG5cbiAgICAgICAgICAgICAgICAvLyBXZSB3aWxsIGxvb2sgZm9yIG90aGVyIHByb2Nlc3Mgd2hpY2ggbWlnaHQgaGF2ZSBiZWVuIGNyZWF0ZWQgb3V0c2lkZSB0aGVcbiAgICAgICAgICAgICAgICAvLyBwcm9jZXNzIHRyZWUuXG4gICAgICAgICAgICAgICAgLy8gTGV0cyBsaXN0IGFsbCBub2RlLmV4ZSBwcm9jZXNzZXMuXG5cbiAgICAgICAgICAgICAgICBjb25zdCBvdXQgPSBzcGF3blxuICAgICAgICAgICAgICAgICAgICAuc3luYyhcbiAgICAgICAgICAgICAgICAgICAgICAgICd3bWljJyxcbiAgICAgICAgICAgICAgICAgICAgICAgIFsncHJvY2VzcycsICd3aGVyZScsICdjYXB0aW9uPVwibm9kZS5leGVcIicsICdnZXQnLCAnY29tbWFuZGxpbmUscHJvY2Vzc2lkJ11cbiAgICAgICAgICAgICAgICAgICAgKVxuICAgICAgICAgICAgICAgICAgICAuc3Rkb3V0LnRvU3RyaW5nKCd1dGYtOCcpXG4gICAgICAgICAgICAgICAgICAgIC5zcGxpdCgnXFxuJyk7XG4gICAgICAgICAgICAgICAgY29uc3QgYXJncyA9IHNlbGYucHJlcGFyZUFyZ3VtZW50cygpO1xuICAgICAgICAgICAgICAgIC8vIExldHMgbW91bnQgcmVnZXguXG4gICAgICAgICAgICAgICAgY29uc3QgcmVnZXhWMSA9IG5ldyBSZWdFeHAoYCR7YXJncy5qb2luKCdcXFxccysnKX1cXFxccysoXFxcXGQrKWAsICdnbScpO1xuICAgICAgICAgICAgICAgIGNvbnN0IHJlZ2V4VjIgPSBuZXcgUmVnRXhwKGBcIiR7YXJncy5qb2luKCdcIlxcXFxzK1wiJyl9XCJcXFxccysoXFxcXGQrKWAsICdnbScpO1xuICAgICAgICAgICAgICAgIC8vIE5vIHdlIHdpbGwgY2hlY2sgZm9yIHRob3NlIHdpdGggdGhlIG1hdGNoaW5nIHBhcmFtcy5cbiAgICAgICAgICAgICAgICBvdXQuZm9yRWFjaCgobGluZSkgPT4ge1xuICAgICAgICAgICAgICAgICAgICBjb25zdCBtYXRjaCA9IHJlZ2V4VjEuZXhlYyhsaW5lKSB8fCByZWdleFYyLmV4ZWMobGluZSkgfHwgZmFsc2U7XG4gICAgICAgICAgICAgICAgICAgIGlmIChtYXRjaCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgc2VsZi5sb2cuZGVidWcoYGtpbGxpbmcgcGlkOiAke21hdGNoWzFdfWApO1xuICAgICAgICAgICAgICAgICAgICAgICAgc3Bhd24uc3luYygndGFza2tpbGwnLCBbJy9waWQnLCBtYXRjaFsxXSwgJy9mJywgJy90J10pO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIHJlZ2V4VjEubGFzdEluZGV4ID0gMDtcbiAgICAgICAgICAgICAgICAgICAgcmVnZXhWMi5sYXN0SW5kZXggPSAwO1xuICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBmdW5jdGlvbiB3cml0ZUxvZygpIHtcbiAgICAgICAgICAgICAgICBmcy53cml0ZUZpbGVTeW5jKCdtZXRlb3IubG9nJywgbG9nLCAnVVRGLTgnKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgZnVuY3Rpb24gY2xlYXJUaW1lb3V0c0FuZEludGVydmFscygpIHtcbiAgICAgICAgICAgICAgICBjbGVhckludGVydmFsKGNvcmRvdmFDaGVja0ludGVydmFsKTtcbiAgICAgICAgICAgICAgICBjbGVhclRpbWVvdXQoYnVpbGRUaW1lb3V0KTtcbiAgICAgICAgICAgICAgICBjbGVhclRpbWVvdXQoZXJyb3JUaW1lb3V0KTtcbiAgICAgICAgICAgICAgICBjbGVhclRpbWVvdXQobWVzc2FnZVRpbWVvdXQpO1xuICAgICAgICAgICAgICAgIGNsZWFyVGltZW91dChraWxsVGltZW91dCk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGNvbnN0IGFyZ3MgPSB0aGlzLnByZXBhcmVBcmd1bWVudHMoKTtcblxuICAgICAgICAgICAgdGhpcy5sb2cuaW5mbyhgcnVubmluZyBcIm1ldGVvciAke2FyZ3Muam9pbignICcpfVwiLi4uIHRoaXMgbWlnaHQgdGFrZSBhIHdoaWxlYCk7XG5cbiAgICAgICAgICAgIGNvbnN0IGVudiA9IHsgTUVURU9SX1BSRVRUWV9PVVRQVVQ6IDAsIE1FVEVPUl9OT19SRUxFQVNFX0NIRUNLOiAxIH07XG4gICAgICAgICAgICBpZiAodGhpcy4kLmVudi5vcHRpb25zLnByb2REZWJ1Zykge1xuICAgICAgICAgICAgICAgIGVudi5NRVRFT1JfREVTS09QX1BST0RfREVCVUcgPSB0cnVlO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAvLyBMZXRzIHNwYXduIG1ldGVvci5cbiAgICAgICAgICAgIGNvbnN0IGNoaWxkID0gc3Bhd24oXG4gICAgICAgICAgICAgICAgJ21ldGVvcicsXG4gICAgICAgICAgICAgICAgYXJncyxcbiAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgIGVudjogT2JqZWN0LmFzc2lnbihlbnYsIHByb2Nlc3MuZW52KSxcbiAgICAgICAgICAgICAgICAgICAgY3dkOiB0aGlzLiQuZW52LnBhdGhzLm1ldGVvckFwcC5yb290XG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICB7IHNoZWxsOiB0cnVlIH1cbiAgICAgICAgICAgICk7XG5cbiAgICAgICAgICAgIC8vIEtpbGxzIHRoZSBjdXJyZW50bHkgcnVubmluZyBtZXRlb3IgY29tbWFuZC5cbiAgICAgICAgICAgIGZ1bmN0aW9uIGtpbGwoc2lnbmFsID0gJ1NJR0tJTEwnKSB7XG4gICAgICAgICAgICAgICAgc2xsKCcnKTtcbiAgICAgICAgICAgICAgICBjaGlsZC5raWxsKHNpZ25hbCk7XG4gICAgICAgICAgICAgICAgaWYgKHNlbGYuJC5lbnYub3MuaXNXaW5kb3dzKSB7XG4gICAgICAgICAgICAgICAgICAgIHdpbmRvd3NLaWxsKGNoaWxkLnBpZCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBmdW5jdGlvbiBleGl0KCkge1xuICAgICAgICAgICAgICAgIGtpbGxUaW1lb3V0ID0gc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgIGNsZWFyVGltZW91dHNBbmRJbnRlcnZhbHMoKTtcbiAgICAgICAgICAgICAgICAgICAgZGVzaXJlZEV4aXQgPSB0cnVlO1xuICAgICAgICAgICAgICAgICAgICBraWxsKCdTSUdURVJNJyk7XG4gICAgICAgICAgICAgICAgICAgIHJlc29sdmUoKTtcbiAgICAgICAgICAgICAgICB9LCA1MDApO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBmdW5jdGlvbiBjb3B5QnVpbGQoKSB7XG4gICAgICAgICAgICAgICAgc2VsZi5jb3B5QnVpbGQoKS50aGVuKCgpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgZXhpdCgpO1xuICAgICAgICAgICAgICAgIH0pLmNhdGNoKCgpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgY2xlYXJUaW1lb3V0c0FuZEludGVydmFscygpO1xuICAgICAgICAgICAgICAgICAgICBraWxsKCk7XG4gICAgICAgICAgICAgICAgICAgIHdyaXRlTG9nKCk7XG4gICAgICAgICAgICAgICAgICAgIHJlamVjdCgnY29weScpO1xuICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBjb3Jkb3ZhQ2hlY2tJbnRlcnZhbCA9IHNldEludGVydmFsKCgpID0+IHtcbiAgICAgICAgICAgICAgICAvLyBDaGVjayBpZiB3ZSBhbHJlYWR5IGhhdmUgY29yZG92YS1idWlsZCByZWFkeS5cbiAgICAgICAgICAgICAgICBpZiAodGhpcy5pc0NvcmRvdmFCdWlsZFJlYWR5KCkpIHtcbiAgICAgICAgICAgICAgICAgICAgLy8gSWYgc28sIHRoZW4gZXhpdCBpbW1lZGlhdGVseS5cbiAgICAgICAgICAgICAgICAgICAgaWYgKHRoaXMuaW5kZXhIVE1Mc3RyYXRlZ3kgPT09XG4gICAgICAgICAgICAgICAgICAgICAgICB0aGlzLmluZGV4SFRNTFN0cmF0ZWdpZXMuSU5ERVhfRlJPTV9DT1JET1ZBX0JVSUxEKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBjb3B5QnVpbGQoKTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0sIDEwMDApO1xuXG4gICAgICAgICAgICBjaGlsZC5zdGRlcnIub24oJ2RhdGEnLCAoY2h1bmspID0+IHtcbiAgICAgICAgICAgICAgICBjb25zdCBsaW5lID0gY2h1bmsudG9TdHJpbmcoJ1VURi04Jyk7XG4gICAgICAgICAgICAgICAgbG9nICs9IGAke2xpbmV9XFxuYDtcbiAgICAgICAgICAgICAgICBpZiAoZXJyb3JUaW1lb3V0KSB7XG4gICAgICAgICAgICAgICAgICAgIGNsZWFyVGltZW91dChlcnJvclRpbWVvdXQpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAvLyBEbyBub3QgZXhpdCBpZiB0aGlzIGlzIHRoZSB3YXJuaW5nIGZvciB1c2luZyAtLXByb2R1Y3Rpb24uXG4gICAgICAgICAgICAgICAgLy8gT3V0cHV0IGV4Y2VlZHMgLT4gaHR0cHM6Ly9naXRodWIuY29tL21ldGVvci9tZXRlb3IvaXNzdWVzLzg1OTJcbiAgICAgICAgICAgICAgICBpZiAoXG4gICAgICAgICAgICAgICAgICAgICF+bGluZS5pbmRleE9mKCctLXByb2R1Y3Rpb24nKSAmJlxuICAgICAgICAgICAgICAgICAgICAhfmxpbmUuaW5kZXhPZignT3V0cHV0IGV4Y2VlZHMgJykgJiZcbiAgICAgICAgICAgICAgICAgICAgIX5saW5lLmluZGV4T2YoJ05vZGUjbW92ZVRvJykgJiZcbiAgICAgICAgICAgICAgICAgICAgIX5saW5lLmluZGV4T2YoJ0Jyb3dzZXJzbGlzdCcpICYmXG4gICAgICAgICAgICAgICAgICAgIChcbiAgICAgICAgICAgICAgICAgICAgICAgIEFycmF5LmlzQXJyYXkoc2VsZi4kLmVudi5vcHRpb25zLmlnbm9yZVN0ZGVycikgJiZcbiAgICAgICAgICAgICAgICAgICAgICAgIHNlbGYuJC5lbnYub3B0aW9ucy5pZ25vcmVTdGRlcnIuZXZlcnkoc3RyID0+ICF+bGluZS5pbmRleE9mKHN0cikpXG4gICAgICAgICAgICAgICAgICAgIClcbiAgICAgICAgICAgICAgICApIHtcbiAgICAgICAgICAgICAgICAgICAgc2VsZi5sb2cud2FybignU1RERVJSOicsIGxpbmUpO1xuICAgICAgICAgICAgICAgICAgICAvLyBXZSB3aWxsIGV4aXQgMXMgYWZ0ZXIgbGFzdCBlcnJvciBpbiBzdGRlcnIuXG4gICAgICAgICAgICAgICAgICAgIGVycm9yVGltZW91dCA9IHNldFRpbWVvdXQoKCkgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgY2xlYXJUaW1lb3V0c0FuZEludGVydmFscygpO1xuICAgICAgICAgICAgICAgICAgICAgICAga2lsbCgpO1xuICAgICAgICAgICAgICAgICAgICAgICAgd3JpdGVMb2coKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIHJlamVjdCgnZXJyb3InKTtcbiAgICAgICAgICAgICAgICAgICAgfSwgMTAwMCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIGNoaWxkLnN0ZG91dC5vbignZGF0YScsIChjaHVuaykgPT4ge1xuICAgICAgICAgICAgICAgIGNvbnN0IGxpbmUgPSBjaHVuay50b1N0cmluZygnVVRGLTgnKTtcbiAgICAgICAgICAgICAgICBpZiAoIWRlc2lyZWRFeGl0ICYmIGxpbmUudHJpbSgpLnJlcGxhY2UoL1tcXG5cXHJcXHRcXHZcXGZdKy9nbSwgJycpICE9PSAnJykge1xuICAgICAgICAgICAgICAgICAgICBjb25zdCBsaW5lc1RvRGlzcGxheSA9IGxpbmUudHJpbSgpXG4gICAgICAgICAgICAgICAgICAgICAgICAuc3BsaXQoJ1xcblxccicpO1xuICAgICAgICAgICAgICAgICAgICAvLyBPbmx5IGRpc3BsYXkgbGFzdCBsaW5lIGZyb20gdGhlIGNodW5rLlxuICAgICAgICAgICAgICAgICAgICBjb25zdCBzYW5pdGl6ZWRMaW5lID0gbGluZXNUb0Rpc3BsYXkucG9wKCkucmVwbGFjZSgvW1xcblxcclxcdFxcdlxcZl0rL2dtLCAnJyk7XG4gICAgICAgICAgICAgICAgICAgIHNsbChzYW5pdGl6ZWRMaW5lKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgbG9nICs9IGAke2xpbmV9XFxuYDtcbiAgICAgICAgICAgICAgICBpZiAofmxpbmUuaW5kZXhPZignYWZ0ZXJfcGxhdGZvcm1fYWRkJykpIHtcbiAgICAgICAgICAgICAgICAgICAgc2xsKCcnKTtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5sb2cuaW5mbygnZG9uZS4uLiAxMCUnKTtcbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICBpZiAofmxpbmUuaW5kZXhPZignTG9jYWwgcGFja2FnZSB2ZXJzaW9uJykpIHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKG1lc3NhZ2VUaW1lb3V0KSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBjbGVhclRpbWVvdXQobWVzc2FnZVRpbWVvdXQpO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIG1lc3NhZ2VUaW1lb3V0ID0gc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICBzbGwoJycpO1xuICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5sb2cuaW5mbygnYnVpbGRpbmcgaW4gcHJvZ3Jlc3MuLi4nKTtcbiAgICAgICAgICAgICAgICAgICAgfSwgMTUwMCk7XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgaWYgKH5saW5lLmluZGV4T2YoJ1ByZXBhcmluZyBDb3Jkb3ZhIHByb2plY3QnKSkge1xuICAgICAgICAgICAgICAgICAgICBzbGwoJycpO1xuICAgICAgICAgICAgICAgICAgICB0aGlzLmxvZy5pbmZvKCdkb25lLi4uIDYwJScpO1xuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIGlmICh+bGluZS5pbmRleE9mKCdDYW5cXCd0IGxpc3RlbiBvbiBwb3J0JykpIHtcbiAgICAgICAgICAgICAgICAgICAgcG9ydFByb2JsZW0gPSB0cnVlO1xuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIGlmICh+bGluZS5pbmRleE9mKCdZb3VyIGFwcGxpY2F0aW9uIGhhcyBlcnJvcnMnKSkge1xuICAgICAgICAgICAgICAgICAgICBpZiAoZXJyb3JUaW1lb3V0KSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBjbGVhclRpbWVvdXQoZXJyb3JUaW1lb3V0KTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICBlcnJvclRpbWVvdXQgPSBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNsZWFyVGltZW91dHNBbmRJbnRlcnZhbHMoKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGtpbGwoKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIHdyaXRlTG9nKCk7XG4gICAgICAgICAgICAgICAgICAgICAgICByZWplY3QoJ2Vycm9ySW5BcHAnKTtcbiAgICAgICAgICAgICAgICAgICAgfSwgMTAwMCk7XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgaWYgKH5saW5lLmluZGV4T2YoJ0FwcCBydW5uaW5nIGF0JykpIHtcbiAgICAgICAgICAgICAgICAgICAgY29weUJ1aWxkKCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIC8vIFdoZW4gTWV0ZW9yIGV4aXRzXG4gICAgICAgICAgICBjaGlsZC5vbignZXhpdCcsICgpID0+IHtcbiAgICAgICAgICAgICAgICBzbGwoJycpO1xuICAgICAgICAgICAgICAgIGNsZWFyVGltZW91dHNBbmRJbnRlcnZhbHMoKTtcbiAgICAgICAgICAgICAgICBpZiAoIWRlc2lyZWRFeGl0KSB7XG4gICAgICAgICAgICAgICAgICAgIHdyaXRlTG9nKCk7XG4gICAgICAgICAgICAgICAgICAgIGlmIChwb3J0UHJvYmxlbSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgcmVqZWN0KCdwb3J0Jyk7XG4gICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgICAgICByZWplY3QoJ2V4aXQnKTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICBidWlsZFRpbWVvdXQgPSBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgICAgICAgICAgICBraWxsKCk7XG4gICAgICAgICAgICAgICAgd3JpdGVMb2coKTtcbiAgICAgICAgICAgICAgICByZWplY3QoJ3RpbWVvdXQnKTtcbiAgICAgICAgICAgIH0sIHRoaXMuJC5lbnYub3B0aW9ucy5idWlsZFRpbWVvdXQgPyB0aGlzLiQuZW52Lm9wdGlvbnMuYnVpbGRUaW1lb3V0ICogMTAwMCA6IDYwMDAwMCk7XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIFJlcGxhY2VzIHRoZSBERFAgdXJsIHRoYXQgd2FzIHVzZWQgb3JpZ2luYWxseSB3aGVuIE1ldGVvciB3YXMgYnVpbGRpbmcgdGhlIGNsaWVudC5cbiAgICAgKiBAcGFyYW0ge3N0cmluZ30gaW5kZXhIdG1sIC0gcGF0aCB0byBpbmRleC5odG1sIGZyb20gdGhlIGNsaWVudFxuICAgICAqL1xuICAgIHVwZGF0ZURkcFVybChpbmRleEh0bWwpIHtcbiAgICAgICAgbGV0IGNvbnRlbnQ7XG4gICAgICAgIGxldCBydW50aW1lQ29uZmlnO1xuXG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICBjb250ZW50ID0gZnMucmVhZEZpbGVTeW5jKGluZGV4SHRtbCwgJ1VURi04Jyk7XG4gICAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgICAgIHRoaXMubG9nLmVycm9yKGBlcnJvciBsb2FkaW5nIGluZGV4Lmh0bWwgZmlsZTogJHtlLm1lc3NhZ2V9YCk7XG4gICAgICAgICAgICBwcm9jZXNzLmV4aXQoMSk7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKCF0aGlzLm1hdGNoZXIudGVzdChjb250ZW50KSkge1xuICAgICAgICAgICAgdGhpcy5sb2cuZXJyb3IoJ2NvdWxkIG5vdCBmaW5kIHJ1bnRpbWUgY29uZmlnIGluIGluZGV4IGZpbGUnKTtcbiAgICAgICAgICAgIHByb2Nlc3MuZXhpdCgxKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICBjb25zdCBtYXRjaGVzID0gY29udGVudC5tYXRjaCh0aGlzLm1hdGNoZXIpO1xuICAgICAgICAgICAgcnVudGltZUNvbmZpZyA9IEpTT04ucGFyc2UoZGVjb2RlVVJJQ29tcG9uZW50KG1hdGNoZXNbMV0pKTtcbiAgICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICAgICAgdGhpcy5sb2cuZXJyb3IoJ2NvdWxkIG5vdCBmaW5kIHJ1bnRpbWUgY29uZmlnIGluIGluZGV4IGZpbGUnKTtcbiAgICAgICAgICAgIHByb2Nlc3MuZXhpdCgxKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmICh0aGlzLiQuZW52Lm9wdGlvbnMuZGRwVXJsLnN1YnN0cigtMSwgMSkgIT09ICcvJykge1xuICAgICAgICAgICAgdGhpcy4kLmVudi5vcHRpb25zLmRkcFVybCArPSAnLyc7XG4gICAgICAgIH1cblxuICAgICAgICBydW50aW1lQ29uZmlnLlJPT1RfVVJMID0gdGhpcy4kLmVudi5vcHRpb25zLmRkcFVybDtcbiAgICAgICAgcnVudGltZUNvbmZpZy5ERFBfREVGQVVMVF9DT05ORUNUSU9OX1VSTCA9IHRoaXMuJC5lbnYub3B0aW9ucy5kZHBVcmw7XG5cbiAgICAgICAgY29udGVudCA9IGNvbnRlbnQucmVwbGFjZShcbiAgICAgICAgICAgIHRoaXMucmVwbGFjZXIsIGAkMVwiJHtlbmNvZGVVUklDb21wb25lbnQoSlNPTi5zdHJpbmdpZnkocnVudGltZUNvbmZpZykpfVwiJDNgXG4gICAgICAgICk7XG5cbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGZzLndyaXRlRmlsZVN5bmMoaW5kZXhIdG1sLCBjb250ZW50KTtcbiAgICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICAgICAgdGhpcy5sb2cuZXJyb3IoYGVycm9yIHdyaXRpbmcgaW5kZXguaHRtbCBmaWxlOiAke2UubWVzc2FnZX1gKTtcbiAgICAgICAgICAgIHByb2Nlc3MuZXhpdCgxKTtcbiAgICAgICAgfVxuICAgICAgICB0aGlzLmxvZy5pbmZvKCdzdWNjZXNzZnVsbHkgdXBkYXRlZCBkZHAgc3RyaW5nIGluIHRoZSBydW50aW1lIGNvbmZpZyBvZiBhIG1vYmlsZSBidWlsZCcgK1xuICAgICAgICAgICAgYCB0byAke3RoaXMuJC5lbnYub3B0aW9ucy5kZHBVcmx9YCk7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogUHJlcGFyZXMgdGhlIGFyZ3VtZW50cyBwYXNzZWQgdG8gYG1ldGVvcmAgY29tbWFuZC5cbiAgICAgKiBAcmV0dXJucyB7c3RyaW5nW119XG4gICAgICovXG4gICAgcHJlcGFyZUFyZ3VtZW50cygpIHtcbiAgICAgICAgY29uc3QgYXJncyA9IFsncnVuJywgJy0tdmVyYm9zZScsIGAtLW1vYmlsZS1zZXJ2ZXI9JHt0aGlzLiQuZW52Lm9wdGlvbnMuZGRwVXJsfWBdO1xuICAgICAgICBpZiAodGhpcy4kLmVudi5pc1Byb2R1Y3Rpb25CdWlsZCgpKSB7XG4gICAgICAgICAgICBhcmdzLnB1c2goJy0tcHJvZHVjdGlvbicpO1xuICAgICAgICB9XG4gICAgICAgIGFyZ3MucHVzaCgnLXAnKTtcbiAgICAgICAgaWYgKHRoaXMuJC5lbnYub3B0aW9ucy5wb3J0KSB7XG4gICAgICAgICAgICBhcmdzLnB1c2godGhpcy4kLmVudi5vcHRpb25zLnBvcnQpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgYXJncy5wdXNoKCczMDgwJyk7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHRoaXMuJC5lbnYub3B0aW9ucy5tZXRlb3JTZXR0aW5ncykge1xuICAgICAgICAgICAgYXJncy5wdXNoKCctLXNldHRpbmdzJywgdGhpcy4kLmVudi5vcHRpb25zLm1ldGVvclNldHRpbmdzKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gYXJncztcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBWYWxpZGF0ZXMgdGhlIG1vYmlsZSBidWlsZCBhbmQgY29waWVzIGl0IGludG8gZWxlY3Ryb24gYXBwLlxuICAgICAqL1xuICAgIGFzeW5jIGNvcHlCdWlsZCgpIHtcbiAgICAgICAgdGhpcy5sb2cuZGVidWcoJ2NsZWFyaW5nIGJ1aWxkIGRpcicpO1xuICAgICAgICB0cnkge1xuICAgICAgICAgICAgYXdhaXQgdGhpcy4kLnV0aWxzLnJtV2l0aFJldHJpZXMoJy1yZicsIHRoaXMuJC5lbnYucGF0aHMuZWxlY3Ryb25BcHAubWV0ZW9yQXBwKTtcbiAgICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGUpO1xuICAgICAgICB9XG5cbiAgICAgICAgbGV0IHByZWZpeCA9ICdjb3Jkb3ZhQnVpbGQnO1xuICAgICAgICBsZXQgY29weVBhdGhQb3N0Zml4ID0gJyc7XG5cbiAgICAgICAgaWYgKHRoaXMuaW5kZXhIVE1Mc3RyYXRlZ3kgPT09IHRoaXMuaW5kZXhIVE1MU3RyYXRlZ2llcy5JTkRFWF9GUk9NX1JVTk5JTkdfU0VSVkVSKSB7XG4gICAgICAgICAgICBwcmVmaXggPSAnd2ViQ29yZG92YSc7XG4gICAgICAgICAgICBjb3B5UGF0aFBvc3RmaXggPSBgJHtwYXRoLnNlcH0qYDtcbiAgICAgICAgICAgIGxldCBpbmRleEh0bWw7XG4gICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgIGZzLm1rZGlyU3luYyh0aGlzLiQuZW52LnBhdGhzLmVsZWN0cm9uQXBwLm1ldGVvckFwcCk7XG4gICAgICAgICAgICAgICAgaW5kZXhIdG1sID0gYXdhaXQgdGhpcy5hY3F1aXJlSW5kZXgoKTtcbiAgICAgICAgICAgICAgICBmcy53cml0ZUZpbGVTeW5jKHRoaXMuJC5lbnYucGF0aHMuZWxlY3Ryb25BcHAubWV0ZW9yQXBwSW5kZXgsIGluZGV4SHRtbCk7XG4gICAgICAgICAgICAgICAgdGhpcy5sb2cuaW5mbygnc3VjY2Vzc2Z1bGx5IGRvd25sb2FkZWQgaW5kZXguaHRtbCBmcm9tIHJ1bm5pbmcgbWV0ZW9yIGFwcCcpO1xuICAgICAgICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICAgICAgICAgIHRoaXMubG9nLmVycm9yKCdlcnJvciB3aGlsZSB0cnlpbmcgdG8gZG93bmxvYWQgaW5kZXguaHRtbCBmb3Igd2ViLmNvcmRvdmEsICcgK1xuICAgICAgICAgICAgICAgICAgICAnYmUgc3VyZSB0aGF0IHlvdSBhcmUgcnVubmluZyBhIG1vYmlsZSB0YXJnZXQgb3Igd2l0aCcgK1xuICAgICAgICAgICAgICAgICAgICAnIC0tbW9iaWxlLXNlcnZlcjogJywgZSk7XG4gICAgICAgICAgICAgICAgdGhyb3cgZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IGNvcmRvdmFCdWlsZCA9IHRoaXMuJC5lbnYucGF0aHMubWV0ZW9yQXBwW3ByZWZpeF07XG4gICAgICAgIGNvbnN0IHsgY29yZG92YUJ1aWxkSW5kZXggfSA9IHRoaXMuJC5lbnYucGF0aHMubWV0ZW9yQXBwO1xuICAgICAgICBjb25zdCBjb3Jkb3ZhQnVpbGRQcm9ncmFtSnNvbiA9IHRoaXMuJC5lbnYucGF0aHMubWV0ZW9yQXBwW2Ake3ByZWZpeH1Qcm9ncmFtSnNvbmBdO1xuXG4gICAgICAgIGlmICghdGhpcy4kLnV0aWxzLmV4aXN0cyhjb3Jkb3ZhQnVpbGQpKSB7XG4gICAgICAgICAgICB0aGlzLmxvZy5lcnJvcihgbm8gbW9iaWxlIGJ1aWxkIGZvdW5kIGF0ICR7Y29yZG92YUJ1aWxkfWApO1xuICAgICAgICAgICAgdGhpcy5sb2cuZXJyb3IoJ2FyZSB5b3Ugc3VyZSB5b3UgZGlkIHJ1biBtZXRlb3Igd2l0aCAtLW1vYmlsZS1zZXJ2ZXI/Jyk7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ3JlcXVpcmVkIGZpbGUgbm90IHByZXNlbnQnKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmICghdGhpcy4kLnV0aWxzLmV4aXN0cyhjb3Jkb3ZhQnVpbGRQcm9ncmFtSnNvbikpIHtcbiAgICAgICAgICAgIHRoaXMubG9nLmVycm9yKCdubyBwcm9ncmFtLmpzb24gZm91bmQgaW4gbW9iaWxlIGJ1aWxkIGZvdW5kIGF0ICcgK1xuICAgICAgICAgICAgICAgIGAke2NvcmRvdmFCdWlsZH1gKTtcbiAgICAgICAgICAgIHRoaXMubG9nLmVycm9yKCdhcmUgeW91IHN1cmUgeW91IGRpZCBydW4gbWV0ZW9yIHdpdGggLS1tb2JpbGUtc2VydmVyPycpO1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdyZXF1aXJlZCBmaWxlIG5vdCBwcmVzZW50Jyk7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAodGhpcy5pbmRleEhUTUxzdHJhdGVneSAhPT0gdGhpcy5pbmRleEhUTUxTdHJhdGVnaWVzLklOREVYX0ZST01fUlVOTklOR19TRVJWRVIpIHtcbiAgICAgICAgICAgIGlmICghdGhpcy4kLnV0aWxzLmV4aXN0cyhjb3Jkb3ZhQnVpbGRJbmRleCkpIHtcbiAgICAgICAgICAgICAgICB0aGlzLmxvZy5lcnJvcignbm8gaW5kZXguaHRtbCBmb3VuZCBpbiBjb3Jkb3ZhIGJ1aWxkIGZvdW5kIGF0ICcgK1xuICAgICAgICAgICAgICAgICAgICBgJHtjb3Jkb3ZhQnVpbGR9YCk7XG4gICAgICAgICAgICAgICAgdGhpcy5sb2cuZXJyb3IoJ2FyZSB5b3Ugc3VyZSB5b3UgZGlkIHJ1biBtZXRlb3Igd2l0aCAtLW1vYmlsZS1zZXJ2ZXI/Jyk7XG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdyZXF1aXJlZCBmaWxlIG5vdCBwcmVzZW50Jyk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICB0aGlzLmxvZy52ZXJib3NlKCdjb3B5aW5nIG1vYmlsZSBidWlsZCcpO1xuICAgICAgICBzaGVsbC5jcChcbiAgICAgICAgICAgICctUicsIGAke2NvcmRvdmFCdWlsZH0ke2NvcHlQYXRoUG9zdGZpeH1gLCB0aGlzLiQuZW52LnBhdGhzLmVsZWN0cm9uQXBwLm1ldGVvckFwcFxuICAgICAgICApO1xuXG4gICAgICAgIC8vIEJlY2F1c2Ugb2YgdmFyaW91cyBwZXJtaXNzaW9uIHByb2JsZW1zIGhlcmUgd2UgdHJ5IHRvIGNsZWFyIHRlIHBhdGggYnkgY2xlYXJpbmdcbiAgICAgICAgLy8gYWxsIHBvc3NpYmxlIHJlc3RyaWN0aW9ucy5cbiAgICAgICAgc2hlbGwuY2htb2QoXG4gICAgICAgICAgICAnLVInLCAnNzc3JywgdGhpcy4kLmVudi5wYXRocy5lbGVjdHJvbkFwcC5tZXRlb3JBcHBcbiAgICAgICAgKTtcbiAgICAgICAgaWYgKHRoaXMuJC5lbnYub3MuaXNXaW5kb3dzKSB7XG4gICAgICAgICAgICBzaGVsbC5leGVjKGBhdHRyaWIgLXIgJHt0aGlzLiQuZW52LnBhdGhzLmVsZWN0cm9uQXBwLm1ldGVvckFwcH0ke3BhdGguc2VwfSouKiAvc2ApO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKHRoaXMuaW5kZXhIVE1Mc3RyYXRlZ3kgPT09IHRoaXMuaW5kZXhIVE1MU3RyYXRlZ2llcy5JTkRFWF9GUk9NX1JVTk5JTkdfU0VSVkVSKSB7XG4gICAgICAgICAgICBsZXQgcHJvZ3JhbUpzb247XG4gICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgIHByb2dyYW1Kc29uID0gYXdhaXQgdGhpcy5hY3F1aXJlTWFuaWZlc3QoKTtcbiAgICAgICAgICAgICAgICBmcy53cml0ZUZpbGVTeW5jKFxuICAgICAgICAgICAgICAgICAgICB0aGlzLiQuZW52LnBhdGhzLmVsZWN0cm9uQXBwLm1ldGVvckFwcFByb2dyYW1Kc29uLFxuICAgICAgICAgICAgICAgICAgICBKU09OLnN0cmluZ2lmeShwcm9ncmFtSnNvbiwgbnVsbCwgNClcbiAgICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgICAgIHRoaXMubG9nLmluZm8oJ3N1Y2Nlc3NmdWxseSBkb3dubG9hZGVkIG1hbmlmZXN0Lmpzb24gZnJvbSBydW5uaW5nIG1ldGVvciBhcHAnKTtcbiAgICAgICAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgICAgICAgICB0aGlzLmxvZy5lcnJvcignZXJyb3Igd2hpbGUgdHJ5aW5nIHRvIGRvd25sb2FkIG1hbmlmZXN0Lmpzb24gZm9yIHdlYi5jb3Jkb3ZhLCcgK1xuICAgICAgICAgICAgICAgICAgICAnIGJlIHN1cmUgdGhhdCB5b3UgYXJlIHJ1bm5pbmcgYSBtb2JpbGUgdGFyZ2V0IG9yIHdpdGgnICtcbiAgICAgICAgICAgICAgICAgICAgJyAtLW1vYmlsZS1zZXJ2ZXI6ICcsIGUpO1xuICAgICAgICAgICAgICAgIHRocm93IGU7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICB0aGlzLmxvZy5pbmZvKCdtb2JpbGUgYnVpbGQgY29waWVkIHRvIGVsZWN0cm9uIGFwcCcpO1xuXG4gICAgICAgIHRoaXMubG9nLmRlYnVnKCdjb3B5IGNvcmRvdmEuanMgdG8gbWV0ZW9yIGJ1aWxkJyk7XG4gICAgICAgIHNoZWxsLmNwKFxuICAgICAgICAgICAgam9pbihfX2Rpcm5hbWUsICcuLicsICdza2VsZXRvbicsICdjb3Jkb3ZhLmpzJyksXG4gICAgICAgICAgICB0aGlzLiQuZW52LnBhdGhzLmVsZWN0cm9uQXBwLm1ldGVvckFwcFxuICAgICAgICApO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIEluamVjdHMgTWV0ZW9yLmlzRGVza3RvcFxuICAgICAqL1xuICAgIGluamVjdElzRGVza3RvcCgpIHtcbiAgICAgICAgdGhpcy5sb2cuaW5mbygnaW5qZWN0aW5nIGlzRGVza3RvcCcpO1xuXG4gICAgICAgIGxldCBtYW5pZmVzdEpzb25QYXRoID0gdGhpcy4kLmVudi5wYXRocy5tZXRlb3JBcHAuY29yZG92YUJ1aWxkUHJvZ3JhbUpzb247XG4gICAgICAgIGlmICh0aGlzLmluZGV4SFRNTHN0cmF0ZWd5ID09PSB0aGlzLmluZGV4SFRNTFN0cmF0ZWdpZXMuSU5ERVhfRlJPTV9SVU5OSU5HX1NFUlZFUikge1xuICAgICAgICAgICAgbWFuaWZlc3RKc29uUGF0aCA9IHRoaXMuJC5lbnYucGF0aHMubWV0ZW9yQXBwLndlYkNvcmRvdmFQcm9ncmFtSnNvbjtcbiAgICAgICAgfVxuXG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICBjb25zdCB7IG1hbmlmZXN0IH0gPSBKU09OLnBhcnNlKFxuICAgICAgICAgICAgICAgIGZzLnJlYWRGaWxlU3luYyhtYW5pZmVzdEpzb25QYXRoLCAnVVRGLTgnKVxuICAgICAgICAgICAgKTtcbiAgICAgICAgICAgIGxldCBpbmplY3RlZCA9IGZhbHNlO1xuICAgICAgICAgICAgbGV0IGluamVjdGVkU3RhcnR1cERpZENvbXBsZXRlID0gZmFsc2U7XG4gICAgICAgICAgICBsZXQgcmVzdWx0ID0gbnVsbDtcblxuICAgICAgICAgICAgLy8gV2Ugd2lsbCBzZWFyY2ggaW4gZXZlcnkgLmpzIGZpbGUgaW4gdGhlIG1hbmlmZXN0LlxuICAgICAgICAgICAgLy8gV2UgY291bGQgcHJvYmFibHkgZGV0ZWN0IHdoZXRoZXIgdGhpcyBpcyBhIGRldiBvciBwcm9kdWN0aW9uIGJ1aWxkIGFuZCBvbmx5IHNlYXJjaCBpblxuICAgICAgICAgICAgLy8gdGhlIGNvcnJlY3QgZmlsZXMsIGJ1dCBmb3Igbm93IHRoaXMgc2hvdWxkIGJlIGZpbmUuXG4gICAgICAgICAgICBtYW5pZmVzdC5mb3JFYWNoKChmaWxlKSA9PiB7XG4gICAgICAgICAgICAgICAgbGV0IGZpbGVDb250ZW50cztcbiAgICAgICAgICAgICAgICAvLyBIYWNreSB3YXkgb2Ygc2V0dGluZyBpc0Rlc2t0b3AuXG4gICAgICAgICAgICAgICAgaWYgKGZpbGUudHlwZSA9PT0gJ2pzJykge1xuICAgICAgICAgICAgICAgICAgICBmaWxlQ29udGVudHMgPSBmcy5yZWFkRmlsZVN5bmMoXG4gICAgICAgICAgICAgICAgICAgICAgICBqb2luKHRoaXMuJC5lbnYucGF0aHMuZWxlY3Ryb25BcHAubWV0ZW9yQXBwLCBmaWxlLnBhdGgpLFxuICAgICAgICAgICAgICAgICAgICAgICAgJ1VURi04J1xuICAgICAgICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgICAgICAgICByZXN1bHQgPSB0aGlzLmluamVjdG9yLnByb2Nlc3NGaWxlQ29udGVudHMoZmlsZUNvbnRlbnRzKTtcblxuICAgICAgICAgICAgICAgICAgICAoeyBmaWxlQ29udGVudHMgfSA9IHJlc3VsdCk7XG4gICAgICAgICAgICAgICAgICAgIGluamVjdGVkU3RhcnR1cERpZENvbXBsZXRlID1cbiAgICAgICAgICAgICAgICAgICAgICAgIHJlc3VsdC5pbmplY3RlZFN0YXJ0dXBEaWRDb21wbGV0ZSA/IHRydWUgOiBpbmplY3RlZFN0YXJ0dXBEaWRDb21wbGV0ZTtcbiAgICAgICAgICAgICAgICAgICAgaW5qZWN0ZWQgPSByZXN1bHQuaW5qZWN0ZWQgPyB0cnVlIDogaW5qZWN0ZWQ7XG5cbiAgICAgICAgICAgICAgICAgICAgZnMud3JpdGVGaWxlU3luYyhcbiAgICAgICAgICAgICAgICAgICAgICAgIGpvaW4odGhpcy4kLmVudi5wYXRocy5lbGVjdHJvbkFwcC5tZXRlb3JBcHAsIGZpbGUucGF0aCksIGZpbGVDb250ZW50c1xuICAgICAgICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICBpZiAoIWluamVjdGVkKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5sb2cuZXJyb3IoJ2Vycm9yIGluamVjdGluZyBpc0Rlc2t0b3AgZ2xvYmFsIHZhci4nKTtcbiAgICAgICAgICAgICAgICBwcm9jZXNzLmV4aXQoMSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAoIWluamVjdGVkU3RhcnR1cERpZENvbXBsZXRlKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5sb2cuZXJyb3IoJ2Vycm9yIGluamVjdGluZyBpc0Rlc2t0b3AgZm9yIHN0YXJ0dXBEaWRDb21wbGV0ZScpO1xuICAgICAgICAgICAgICAgIHByb2Nlc3MuZXhpdCgxKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICAgICAgdGhpcy5sb2cuZXJyb3IoJ2Vycm9yIG9jY3VycmVkIHdoaWxlIGluamVjdGluZyBpc0Rlc2t0b3A6ICcsIGUpO1xuICAgICAgICAgICAgcHJvY2Vzcy5leGl0KDEpO1xuICAgICAgICB9XG4gICAgICAgIHRoaXMubG9nLmluZm8oJ2luamVjdGVkIHN1Y2Nlc3NmdWxseScpO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIEJ1aWxkcywgbW9kaWZpZXMgYW5kIGNvcGllcyB0aGUgbWV0ZW9yIGFwcCB0byBlbGVjdHJvbiBhcHAuXG4gICAgICovXG4gICAgYXN5bmMgYnVpbGQoKSB7XG4gICAgICAgIHRoaXMubG9nLmluZm8oJ2NoZWNraW5nIGZvciBhbnkgbW9iaWxlIHBsYXRmb3JtJyk7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLmNoZWNrUHJlY29uZGl0aW9ucygpO1xuICAgICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgICAgICB0aGlzLmxvZy5lcnJvcignZXJyb3Igb2NjdXJyZWQgZHVyaW5nIGNoZWNraW5nIHByZWNvbmRpdGlvbnM6ICcsIGUpO1xuICAgICAgICAgICAgcHJvY2Vzcy5leGl0KDEpO1xuICAgICAgICB9XG5cbiAgICAgICAgdGhpcy5sb2cuaW5mbygnYnVpbGRpbmcgbWV0ZW9yIGFwcCcpO1xuXG4gICAgICAgIGlmICghdGhpcy4kLmVudi5vcHRpb25zLnNraXBNb2JpbGVCdWlsZCkge1xuICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICBhd2FpdCB0aGlzLmJ1aWxkTW9iaWxlVGFyZ2V0KCk7XG4gICAgICAgICAgICB9IGNhdGNoIChyZWFzb24pIHtcbiAgICAgICAgICAgICAgICBzd2l0Y2ggKHJlYXNvbikge1xuICAgICAgICAgICAgICAgICAgICBjYXNlICd0aW1lb3V0JzpcbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMubG9nLmVycm9yKFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICd0aW1lb3V0IHdoaWxlIGJ1aWxkaW5nLCBsb2cgaGFzIGJlZW4gd3JpdHRlbiB0byBtZXRlb3IubG9nJ1xuICAgICAgICAgICAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgICAgICAgICBjYXNlICdlcnJvcic6XG4gICAgICAgICAgICAgICAgICAgICAgICB0aGlzLmxvZy5lcnJvcihcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAnYnVpbGQgd2FzIHRlcm1pbmF0ZWQgYnkgbWV0ZW9yLWRlc2t0b3AgYXMgc29tZSBlcnJvcnMgd2VyZSByZXBvcnRlZCB0byBzdGRlcnIsIHlvdSAnICtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAnc2hvdWxkIHNlZSBpdCBhYm92ZSwgYWxzbyBjaGVjayBtZXRlb3IubG9nIGZvciBtb3JlIGluZm8sIHRvIGlnbm9yZSBpdCB1c2UgdGhlICcgK1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICctLWlnbm9yZS1zdGRlcnIgXCI8c3RyaW5nPlwiJ1xuICAgICAgICAgICAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgICAgICAgICBjYXNlICdlcnJvckluQXBwJzpcbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMubG9nLmVycm9yKFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICd5b3VyIG1ldGVvciBhcHAgaGFzIGVycm9ycyAtIGxvb2sgaW50byBtZXRlb3IubG9nIGZvciBtb3JlJyArXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgJyBpbmZvJ1xuICAgICAgICAgICAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgICAgICAgICBjYXNlICdwb3J0JzpcbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMubG9nLmVycm9yKFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICd5b3VyIHBvcnQgMzA4MCBpcyBjdXJyZW50bHkgdXNlZCAoeW91IHByb2JhYmx5IGhhdmUgdGhpcyBvciBvdGhlciAnICtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAnbWV0ZW9yIHByb2plY3QgcnVubmluZz8pLCB1c2UgYC10YCBvciBgLS1tZXRlb3ItcG9ydGAgdG8gdXNlICcgK1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICdkaWZmZXJlbnQgcG9ydCB3aGlsZSBidWlsZGluZydcbiAgICAgICAgICAgICAgICAgICAgICAgICk7XG4gICAgICAgICAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgICAgICAgY2FzZSAnZXhpdCc6XG4gICAgICAgICAgICAgICAgICAgICAgICB0aGlzLmxvZy5lcnJvcihcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAnbWV0ZW9yIGNtZCBleGl0ZWQgdW5leHBlY3RlZGx5LCBsb2cgaGFzIGJlZW4gd3JpdHRlbiB0byBtZXRlb3IubG9nJ1xuICAgICAgICAgICAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgICAgICAgICBjYXNlICdjb3B5JzpcbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMubG9nLmVycm9yKFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICdlcnJvciBlbmNvdW50ZXJlZCB3aGVuIGNvcHlpbmcgdGhlIGJ1aWxkJ1xuICAgICAgICAgICAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgICAgICAgICBkZWZhdWx0OlxuICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5sb2cuZXJyb3IoJ2Vycm9yIG9jY3VycmVkIGR1cmluZyBidWlsZGluZyBtb2JpbGUgdGFyZ2V0JywgcmVhc29uKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgaWYgKHRoaXMubW9iaWxlUGxhdGZvcm0pIHtcbiAgICAgICAgICAgICAgICAgICAgYXdhaXQgdGhpcy5yZW1vdmVNb2JpbGVQbGF0Zm9ybSh0aGlzLm1vYmlsZVBsYXRmb3JtKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgcHJvY2Vzcy5leGl0KDEpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgdGhpcy5pbmRleEhUTUxzdHJhdGVneSA9IHRoaXMuY2hvb3NlU3RyYXRlZ3koKTtcbiAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgYXdhaXQgdGhpcy5jb3B5QnVpbGQoKTtcbiAgICAgICAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgICAgICAgICBwcm9jZXNzLmV4aXQoMSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICB0aGlzLmluamVjdElzRGVza3RvcCgpO1xuXG4gICAgICAgIHRoaXMuY2hhbmdlRGRwVXJsKCk7XG5cbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMucGFja1RvQXNhcigpO1xuICAgICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgICAgICB0aGlzLmxvZy5lcnJvcignZXJyb3Igd2hpbGUgcGFja2luZyBtZXRlb3IgYXBwIHRvIGFzYXInKTtcbiAgICAgICAgICAgIHByb2Nlc3MuZXhpdCgxKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHRoaXMubG9nLmluZm8oJ21ldGVvciBidWlsZCBmaW5pc2hlZCcpO1xuXG4gICAgICAgIGlmICh0aGlzLm1vYmlsZVBsYXRmb3JtKSB7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLnJlbW92ZU1vYmlsZVBsYXRmb3JtKHRoaXMubW9iaWxlUGxhdGZvcm0pO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgY2hhbmdlRGRwVXJsKCkge1xuICAgICAgICBpZiAodGhpcy4kLmVudi5vcHRpb25zLmRkcFVybCAhPT0gbnVsbCkge1xuICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICB0aGlzLnVwZGF0ZURkcFVybCh0aGlzLiQuZW52LnBhdGhzLmVsZWN0cm9uQXBwLm1ldGVvckFwcEluZGV4KTtcbiAgICAgICAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgICAgICAgICB0aGlzLmxvZy5lcnJvcihgZXJyb3Igd2hpbGUgdHJ5aW5nIHRvIGNoYW5nZSB0aGUgZGRwIHVybDogJHtlLm1lc3NhZ2V9YCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBwYWNrVG9Bc2FyKCkge1xuICAgICAgICB0aGlzLmxvZy5pbmZvKCdwYWNraW5nIG1ldGVvciBhcHAgdG8gYXNhciBhcmNoaXZlJyk7XG4gICAgICAgIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PlxuICAgICAgICAgICAgYXNhci5jcmVhdGVQYWNrYWdlKFxuICAgICAgICAgICAgICAgIHRoaXMuJC5lbnYucGF0aHMuZWxlY3Ryb25BcHAubWV0ZW9yQXBwLFxuICAgICAgICAgICAgICAgIHBhdGguam9pbih0aGlzLiQuZW52LnBhdGhzLmVsZWN0cm9uQXBwLnJvb3QsICdtZXRlb3IuYXNhcicpXG4gICAgICAgICAgICApXG4gICAgICAgICAgICAgICAgLnRoZW4oKCkgPT4ge1xuICAgICAgICAgICAgICAgICAgICAvLyBPbiBXaW5kb3dzIHNvbWUgZmlsZXMgbWlnaHQgc3RpbGwgYmUgYmxvY2tlZC4gR2l2aW5nIGEgdGljayBmb3IgdGhlbSB0byBiZVxuICAgICAgICAgICAgICAgICAgICAvLyByZWFkeSBmb3IgZGVsZXRpb24uXG4gICAgICAgICAgICAgICAgICAgIHNldEltbWVkaWF0ZSgoKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICB0aGlzLmxvZy52ZXJib3NlKCdjbGVhcmluZyBtZXRlb3IgYXBwIGFmdGVyIHBhY2tpbmcnKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuJC51dGlsc1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIC5ybVdpdGhSZXRyaWVzKCctcmYnLCB0aGlzLiQuZW52LnBhdGhzLmVsZWN0cm9uQXBwLm1ldGVvckFwcClcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAudGhlbigoKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJlc29sdmUoKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9KVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIC5jYXRjaCgoZSkgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICByZWplY3QoZSk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgIH0pKTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBXcmFwcGVyIGZvciBzcGF3bmluZyBucG0uXG4gICAgICogQHBhcmFtIHtBcnJheX0gIGNvbW1hbmRzIC0gY29tbWFuZHMgZm9yIHNwYXduXG4gICAgICogQHBhcmFtIHtzdHJpbmd9IHN0ZGlvXG4gICAgICogQHBhcmFtIHtzdHJpbmd9IGN3ZFxuICAgICAqIEByZXR1cm4ge1Byb21pc2V9XG4gICAgICovXG4gICAgcnVuTnBtKGNvbW1hbmRzLCBzdGRpbyA9ICdpZ25vcmUnLCBjd2QgPSB0aGlzLiQuZW52LnBhdGhzLm1ldGVvckFwcC5yb290KSB7XG4gICAgICAgIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICAgICAgICB0aGlzLmxvZy52ZXJib3NlKGBleGVjdXRpbmcgbWV0ZW9yIG5wbSAke2NvbW1hbmRzLmpvaW4oJyAnKX1gKTtcblxuICAgICAgICAgICAgc3Bhd24oJ21ldGVvcicsIFsnbnBtJywgLi4uY29tbWFuZHNdLCB7XG4gICAgICAgICAgICAgICAgY3dkLFxuICAgICAgICAgICAgICAgIHN0ZGlvXG4gICAgICAgICAgICB9KS5vbignZXhpdCcsIGNvZGUgPT4gKFxuICAgICAgICAgICAgICAgIChjb2RlID09PSAwKSA/IHJlc29sdmUoKSA6IHJlamVjdChuZXcgRXJyb3IoYG5wbSBleGl0IGNvZGUgd2FzICR7Y29kZX1gKSlcbiAgICAgICAgICAgICkpO1xuICAgICAgICB9KTtcbiAgICB9XG59XG4iXSwibWFwcGluZ3MiOiI7Ozs7OztBQUNBLElBQUFBLFFBQUEsR0FBQUMsc0JBQUEsQ0FBQUMsT0FBQTtBQUNBLElBQUFDLEdBQUEsR0FBQUYsc0JBQUEsQ0FBQUMsT0FBQTtBQUNBLElBQUFFLFdBQUEsR0FBQUgsc0JBQUEsQ0FBQUMsT0FBQTtBQUNBLElBQUFHLE9BQUEsR0FBQUosc0JBQUEsQ0FBQUMsT0FBQTtBQUNBLElBQUFJLFFBQUEsR0FBQUwsc0JBQUEsQ0FBQUMsT0FBQTtBQUNBLElBQUFLLEtBQUEsR0FBQU4sc0JBQUEsQ0FBQUMsT0FBQTtBQUNBLElBQUFNLGNBQUEsR0FBQVAsc0JBQUEsQ0FBQUMsT0FBQTtBQUNBLElBQUFPLEtBQUEsR0FBQVIsc0JBQUEsQ0FBQUMsT0FBQTtBQUNBLElBQUFRLFVBQUEsR0FBQVQsc0JBQUEsQ0FBQUMsT0FBQTtBQUVBLElBQUFTLGtCQUFBLEdBQUFWLHNCQUFBLENBQUFDLE9BQUE7QUFDQSxJQUFBVSxJQUFBLEdBQUFYLHNCQUFBLENBQUFDLE9BQUE7QUFDQSxJQUFBVyxjQUFBLEdBQUFaLHNCQUFBLENBQUFDLE9BQUE7QUFBNEMsU0FBQUQsdUJBQUFhLENBQUEsV0FBQUEsQ0FBQSxJQUFBQSxDQUFBLENBQUFDLFVBQUEsR0FBQUQsQ0FBQSxLQUFBRSxPQUFBLEVBQUFGLENBQUE7QUFiNUM7O0FBZUEsTUFBTTtFQUFFRztBQUFLLENBQUMsR0FBR0MsYUFBSTtBQUNyQixNQUFNQyxHQUFHLEdBQUdDLHNCQUFhLENBQUNDLE1BQU07O0FBRWhDOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDZSxNQUFNQyxTQUFTLENBQUM7RUFDM0I7QUFDSjtBQUNBO0FBQ0E7RUFDSUMsV0FBV0EsQ0FBQ0MsQ0FBQyxFQUFFO0lBQ1gsSUFBSSxDQUFDQyxH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Q0FBQ3NDLEdBQUcsQ0FBQ0MsS0FBSyxDQUFDTyxXQUFXLENBQUNrQyxJQUFJLEVBQUUsYUFBYSxDQUM5RCxDQUFDLENBQ0k0RCxJQUFJLENBQUMsTUFBTTtNQUNSO01BQ0E7TUFDQXdELFlBQVksQ0FBQyxNQUFNO1FBQ2YsSUFBSSxDQUFDbk0sR0FBRyxDQUFDMkIsT0FBTyxDQUFDLG1DQUFtQyxDQUFDO1FBQ3JELElBQUksQ0FBQzVCLENBQUMsQ0FBQ3lGLEtBQUssQ0FDUGdGLGFBQWEsQ0FBQyxLQUFLLEVBQUUsSUFBSSxDQUFDekssQ0FBQyxDQUFDc0MsR0FBRyxDQUFDQyxLQUFLLENBQUNPLFdBQVcsQ0FBQ04sU0FBUyxDQUFDLENBQzVEb0csSUFBSSxDQUFDLE1BQU07VUFDUmhFLE9BQU8sQ0FBQyxDQUFDO1FBQ2IsQ0FBQyxDQUFDLENBQ0RpRSxLQUFLLENBQUV2SixDQUFDLElBQUs7VUFDVnVGLE1BQU0sQ0FBQ3ZGLENBQUMsQ0FBQztRQUNiLENBQUMsQ0FBQztNQUNWLENBQUMsQ0FBQztJQUNOLENBQUMsQ0FBQyxDQUFDO0VBQ2Y7O0VBRUE7QUFDSjtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7RUFDSStNLE1BQU1BLENBQUNDLFFBQVEsRUFBRXJILEtBQUssR0FBRyxRQUFRLEVBQUVGLEdBQUcsR0FBRyxJQUFJLENBQUMvRSxDQUFDLENBQUNzQyxHQUFHLENBQUNDLEtBQUssQ0FBQ0MsU0FBUyxDQUFDd0MsSUFBSSxFQUFFO0lBQ3RFLE9BQU8sSUFBSUwsT0FBTyxDQUFDLENBQUNDLE9BQU8sRUFBRUMsTUFBTSxLQUFLO01BQ3BDLElBQUksQ0FBQzVFLEdBQUcsQ0FBQzJCLE9BQU8sQ0FBQyx3QkFBd0IwSyxRQUFRLENBQUM3TSxJQUFJLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQztNQUU5RCxJQUFBcUYsbUJBQUssRUFBQyxRQUFRLEVBQUUsQ0FBQyxLQUFLLEVBQUUsR0FBR3dILFFBQVEsQ0FBQyxFQUFFO1FBQ2xDdkgsR0FBRztRQUNIRTtNQUNKLENBQUMsQ0FBQyxDQUFDQyxFQUFFLENBQUMsTUFBTSxFQUFFcUgsSUFBSSxJQUNiQSxJQUFJLEtBQUssQ0FBQyxHQUFJM0gsT0FBTyxDQUFDLENBQUMsR0FBR0MsTUFBTSxDQUFDLElBQUl2RCxLQUFLLENBQUMscUJBQXFCaUwsSUFBSSxFQUFFLENBQUMsQ0FDM0UsQ0FBQztJQUNOLENBQUMsQ0FBQztFQUNOO0FBQ0o7QUFBQ0MsT0FBQSxDQUFBaE4sT0FBQSxHQUFBTSxTQUFBIiwiaWdub3JlTGlzdCI6W119