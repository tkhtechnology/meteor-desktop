"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
var _runtime = _interopRequireDefault(require("regenerator-runtime/runtime"));
var _asar = _interopRequireDefault(require("@electron/asar"));
var _assignIn = _interopRequireDefault(require("lodash/assignIn"));
var _lodash = _interopRequireDefault(require("lodash"));
var _installLocal = require("install-local");
var _core = require("@babel/core");
var _crypto = _interopRequireDefault(require("crypto"));
var _del = _interopRequireDefault(require("del"));
var _presetEnv = _interopRequireDefault(require("@babel/preset-env"));
var _fs = _interopRequireDefault(require("fs"));
var _path = _interopRequireDefault(require("path"));
var _shelljs = _interopRequireDefault(require("shelljs"));
var _semver = _interopRequireDefault(require("semver"));
var _terser = _interopRequireDefault(require("terser"));
var _log = _interopRequireDefault(require("./log"));
var _electronAppScaffold = _interopRequireDefault(require("./electronAppScaffold"));
var _dependenciesManager = _interopRequireDefault(require("./dependenciesManager"));
var _binaryModulesDetector = _interopRequireDefault(require("./binaryModulesDetector"));
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
// eslint-disable-next-line no-unused-vars

_shelljs.default.config.fatal = true;

/**
 * Represents the .desktop dir scaffold.
 * @class
 */
class ElectronApp {
  /**
   * @param {MeteorDesktop} $ - context
   * @constructor
   */
  constructor($) {
    this.log = new _log.default('electronApp');
    this.scaffold = new _electronAppScaffold.default($);
    this.depsManager = new _dependenciesManager.default($, this.scaffold.getDefaultPackageJson().dependencies);
    this.$ = $;
    this.meteorApp = this.$.meteorApp;
    this.packageJson = null;
    this.version = null;
    this.compatibilityVersion = null;
    this.deprectatedPlugins = ['meteor-desktop-localstorage'];
  }

  /**
   * Makes an app.asar from the skeleton app.
   * @property {Array} excludeFromDel - list of paths to exclude from deleting
   * @returns {Promise}
   */
  packSkeletonToAsar(excludeFromDel = []) {
    this.log.info('packing skeleton app and node_modules to asar archive');
    return new Promise(resolve => {
      const extract = this.getModulesToExtract();

      // We want to pack skeleton app and node_modules together, so we need to temporarily
      // move node_modules to app dir.
      this.log.debug('moving node_modules to app dir');
      _fs.default.renameSync(this.$.env.paths.electronApp.nodeModules, _path.default.join(this.$.env.paths.electronApp.appRoot, 'node_modules'));
      let extracted = false;
      extracted = this.extractModules(extract);
      this.log.debug('packing');
      _asar.default.createPackage(this.$.env.paths.electronApp.appRoot, this.$.env.paths.electronApp.appAsar).then(() => {
        // Lets move the node_modules back.
        this.log.debug('moving node_modules back from app dir');
        _shelljs.default.mv(_path.default.join(this.$.env.paths.electronApp.appRoot, 'node_modules'), this.$.env.paths.electronApp.nodeModules);
        if (extracted) {
          // We need to create a full node modules back. In other words we want
          // the extracted modules back.
          extract.forEach(module => _shelljs.default.cp('-rf', _path.default.join(this.$.env.paths.electronApp.extractedNodeModules, module), _path.default.join(this.$.env.paths.electronApp.nodeModules, module)));

          // Get the .bin back.
          if (this.$.utils.exists(this.$.env.paths.electronApp.extractedNodeModulesBin)) {
            _shelljs.default.cp(_path.default.join(this.$.env.paths.electronApp.extractedNodeModulesBin, '*'), _path.default.join(this.$.env.paths.electronApp.nodeModules, '.bin'));
          }
        }
        this.log.debug('deleting source files');
        const exclude = [this.$.env.paths.electronApp.nodeModules].concat([this.$.env.paths.electronApp.appAsar, this.$.env.paths.electronApp.packageJson], excludeFromDel);
        _del.default.sync([`${this.$.env.paths.electronApp.root}${_path.default.sep}*`].concat(exclude.map(pathToExclude => `!${pathToExclude}`)), {
          force: true
        });
        resolve();
      });
    });
  }

  /**
   * Moves specified node modules to a separate directory.
   * @param {Array} extract
   * @returns {boolean}
   */
  extractModules(extract) {
    const ext = ['.js', '.bat', '.sh', '.cmd', ''];
    if (extract.length > 0) {
      if (this.$.utils.exists(this.$.env.paths.electronApp.extractedNodeModules)) {
        _shelljs.default.rm('-rf', this.$.env.paths.electronApp.extractedNodeModules);
      }
      _fs.default.mkdirSync(this.$.env.paths.electronApp.extractedNodeModules);
      _fs.default.mkdirSync(this.$.env.paths.electronApp.extractedNodeModulesBin);
      extract.forEach(module => {
        _fs.default.renameSync(_path.default.join(this.$.env.paths.electronApp.appRoot, 'node_modules', module), _path.default.join(this.$.env.paths.electronApp.extractedNodeModules, module));
        // Move bins.
        this.extractBin(module, ext);
      });
      return true;
    }
    return false;
  }

  /**
   * Extracts the bin files associated with a certain node modules.
   *
   * @param module
   * @param ext
   */
  extractBin(module, ext) {
    let packageJson;
    try {
      packageJson = JSON.parse(_fs.default.readFileSync(_path.default.join(this.$.env.paths.electronApp.extractedNodeModules, module, 'package.json'), 'utf8'));
    } catch (e) {
      packageJson = {};
    }
    const bins = 'bin' in packageJson && typeof packageJson.bin === 'object' ? Object.keys(packageJson.bin) : [];
    if (bins.length > 0) {
      bins.forEach(bin => {
        ext.forEach(extension => {
          const binFilePath = _path.default.join(this.$.env.paths.electronApp.appRoot, 'node_modules', '.bin', `${bin}${extension}`);
          if (this.$.utils.exists(binFilePath) || this.$.utils.symlinkExists(binFilePath)) {
            _fs.default.renameSync(binFilePath, _path.default.join(this.$.env.paths.electronApp.extractedNodeModulesBin, `${bin}${extension}`));
          }
        });
      });
    }
  }

  /**
   * Merges the `extract` field with automatically detected modules.
   */
  getModulesToExtract() {
    const binaryModulesDetector = new _binaryModulesDetector.default(this.$.env.paths.electronApp.nodeModules);
    const toBeExtracted = binaryModulesDetector.detect();
    let {
      extract
    } = this.$.desktop.getSettings();
    if (!Array.isArray(extract)) {
      extract = [];
    }
    const merge = {};
    toBeExtracted.concat(extract).forEach(module => {
      merge[module] = true;
    });
    extract = Object.keys(merge);
    if (extract.length > 0) {
      this.log.verbose(`resultant modules to extract list is: ${extract.join(', ')}`);
    }
    return extract;
  }

  /**
   * Calculates a md5 from all dependencies.
   */
  calculateCompatibilityVersion() {
    this.log.verbose('calculating compatibility version');
    const settings = this.$.desktop.getSettings();
    if ('desktopHCPCompatibilityVersion' in settings) {
      this.compatibilityVersion = `${settings.desktopHCPCompatibilityVersion}`;
      this.log.warn(`compatibility version overridden to ${this.compatibilityVersion}`);
      return;
    }
    const md5 = _crypto.default.createHash('md5');
    let dependencies = this.depsManager.getDependencies();
    const dependenciesSorted = Object.keys(dependencies).sort();
    dependencies = dependenciesSorted.map(dependency => `${dependency}:${dependencies[dependency]}`);
    const mainCompatibilityVersion = this.$.getVersion().split('.');
    this.log.debug('meteor-desktop compatibility version is ', `${mainCompatibilityVersion[0]}`);
    dependencies.push(`meteor-desktop:${mainCompatibilityVersion[0]}`);
    const desktopCompatibilityVersion = settings.version.split('.')[0];
    this.log.debug('.desktop compatibility version is ', desktopCompatibilityVersion);
    dependencies.push(`desktop-app:${desktopCompatibilityVersion}`);
    if (process.env.METEOR_DESKTOP_DEBUG_DESKTOP_COMPATIBILITY_VERSION || process.env.METEOR_DESKTOP_DEBUG) {
      this.log.debug(`compatibility version calculated from ${JSON.stringify(dependencies)}`);
    }
    md5.update(JSON.stringify(dependencies));
    this.compatibilityVersion = md5.digest('hex');
  }
  async init() {
    try {
      await this.$.electron.init();
      await this.$.electronBuilder.init();
    } catch (e) {
      this.log.warn('error occurred while initialising electron and electron-builder integration', e);
      process.exit(1);
    }
  }

  /**
   * Runs all necessary tasks to build the desktopified app.
   */
  async build(run = false) {
    // TODO: refactor to a task runner
    this.log.info('scaffolding');
    if (!this.$.desktop.check()) {
      if (!this.$.env.options.scaffold) {
        this.log.error('seems that you do not have a .desktop dir in your project or it is' + ' corrupted. Run \'npm run desktop -- init\' to get a new one.');
        // Do not fail, so that npm will not print his error stuff to console.
        process.exit(0);
      } else {
        this.$.desktop.scaffold();
        this.$.meteorApp.updateGitIgnore();
      }
    }
    await this.init();
    try {
      this.$.meteorApp.updateGitIgnore();
    } catch (e) {
      this.log.warn(`error occurred while adding ${this.$.env.paths.electronApp.rootName}` + 'to .gitignore: ', e);
    }
    try {
      await this.$.meteorApp.removeDeprecatedPackages();
    } catch (e) {
      this.log.error('error while removing deprecated packages: ', e);
      process.exit(1);
    }
    try {
      await this.$.meteorApp.ensureDesktopHCPPackages();
    } catch (e) {
      this.log.error('error while checking for required packages: ', e);
      process.exit(1);
    }
    try {
      await this.scaffold.make();
    } catch (e) {
      this.log.error('error while scaffolding: ', e);
      process.exit(1);
    }
    try {
      const fileName = '.npmrc';
      const dirName = '.meteor/desktop-build';
      if (_fs.default.existsSync(dirName) && _fs.default.existsSync(fileName)) {
        _fs.default.copyFileSync(fileName, `${dirName}/${fileName}`);
      }
    } catch (e) {
      this.log.warn('error while copying .npmrc', e);
    }
    try {
      await this.exposeElectronModules();
    } catch (e) {
      this.log.error('error while exposing electron modules: ', e);
      process.exit(1);
    }
    try {
      this.updatePackageJsonFields();
    } catch (e) {
      this.log.error('error while updating package.json: ', e);
    }
    try {
      this.updateDependenciesList();
    } catch (e) {
      this.log.error('error while merging dependencies list: ', e);
    }
    try {
      this.calculateCompatibilityVersion();
    } catch (e) {
      this.log.error('error while calculating compatibility version: ', e);
      process.exit(1);
    }
    try {
      await this.handleTemporaryNodeModules();
    } catch (e) {
      this.log.error('error occurred while handling temporary node_modules: ', e);
      process.exit(1);
    }
    let nodeModulesRemoved;
    try {
      nodeModulesRemoved = await this.handleStateOfNodeModules();
    } catch (e) {
      this.log.error('error occurred while clearing node_modules: ', e);
      process.exit(1);
    }
    try {
      await this.rebuildDeps(true);
    } catch (e) {
      this.log.error('error occurred while installing node_modules: ', e);
      process.exit(1);
    }
    if (!nodeModulesRemoved) {
      try {
        await this.rebuildDeps();
      } catch (e) {
        this.log.error('error occurred while rebuilding native node modules: ', e);
        process.exit(1);
      }
    }
    try {
      await this.linkNpmPackages();
    } catch (e) {
      this.log.error(`linking packages failed: ${e}`);
      process.exit(1);
    }
    try {
      await this.installLocalNodeModules();
    } catch (e) {
      this.log.error('error occurred while installing local node modules: ', e);
      process.exit(1);
    }
    try {
      await this.ensureMeteorDependencies();
    } catch (e) {
      this.log.error('error occurred while ensuring meteor dependencies are installed: ', e);
      process.exit(1);
    }
    if (this.$.env.isProductionBuild()) {
      try {
        await this.packSkeletonToAsar();
      } catch (e) {
        this.log.error('error while packing skeleton to asar: ', e);
        process.exit(1);
      }
    }

    // TODO: find a way to avoid copying .desktop to a temp location
    try {
      this.copyDesktopToDesktopTemp();
    } catch (e) {
      this.log.error('error while copying .desktop to a temporary location: ', e);
      process.exit(1);
    }
    try {
      await this.updateSettingsJsonFields();
    } catch (e) {
      this.log.error('error while updating settings.json: ', e);
      process.exit(1);
    }
    try {
      await this.excludeFilesFromArchive();
    } catch (e) {
      this.log.error('error while excluding files from packing to asar: ', e);
      process.exit(1);
    }
    try {
      await this.transpileAndMinify();
    } catch (e) {
      this.log.error('error while transpiling or minifying: ', e);
    }
    try {
      await this.packDesktopToAsar();
    } catch (e) {
      this.log.error('error occurred while packing .desktop to asar: ', e);
      process.exit(1);
    }
    try {
      await this.getMeteorClientBuild();
    } catch (e) {
      this.log.error('error occurred during getting meteor mobile build: ', e);
    }
    if (run) {
      this.log.info('running');
      this.$.electron.run();
    } else {
      this.log.info('built');
    }
  }

  /**
   * Copies the `exposedModules` setting from `settings.json` into `preload.js` modifying its code
   * so that the script will have it hardcoded.
   */
  exposeElectronModules() {
    const {
      exposedModules
    } = this.$.desktop.getSettings();
    if (exposedModules && Array.isArray(exposedModules) && exposedModules.length > 0) {
      let preload = _fs.default.readFileSync(this.$.env.paths.electronApp.preload, 'utf8');
      const modules = this.$.desktop.getSettings().exposedModules.reduce(
      // eslint-disable-next-line no-return-assign,no-param-reassign
      (prev, module) => (prev += `'${module}', `, prev), '');
      preload = preload.replace('const exposedModules = [', `const exposedModules = [${modules}`);
      _fs.default.writeFileSync(this.$.env.paths.electronApp.preload, preload);
    }
  }

  /**
   * Ensures all required dependencies are added to the Meteor project.
   * @returns {Promise.<void>}
   */
  async ensureMeteorDependencies() {
    let packages = [];
    const packagesWithVersion = [];
    let plugins = 'plugins [';
    Object.keys(this.$.desktop.getDependencies().plugins).forEach(plugin => {
      // Read package.json of the plugin.
      const packageJson = JSON.parse(_fs.default.readFileSync(_path.default.join(this.$.env.paths.electronApp.nodeModules, plugin, 'package.json'), 'utf8'));
      if ('meteorDependencies' in packageJson && typeof packageJson.meteorDependencies === 'object') {
        plugins += `${plugin}, `;
        packages.unshift(...Object.keys(packageJson.meteorDependencies));
        packagesWithVersion.unshift(...packages.map(packageName => {
          if (packageJson.meteorDependencies[packageName] === '@version') {
            return `${packageName}@${packageJson.version}`;
          }
          return `${packageName}@${packageJson.meteorDependencies[packageName]}`;
        }));
      }
    });
    const packagesCount = packages.length;
    packages = packages.filter(value => !this.deprectatedPlugins.includes(value));
    if (packagesCount !== packages.length) {
      this.log.warn('you have some deprecated meteor desktop plugins in your settings, please remove ' + `them (deprecated plugins: ${this.deprectatedPlugins.join(', ')})`);
    }
    if (packages.length > 0) {
      plugins = `${plugins.substr(0, plugins.length - 2)}]`;
      try {
        await this.$.meteorApp.meteorManager.ensurePackages(packages, packagesWithVersion, plugins);
      } catch (e) {
        throw new Error(e);
      }
    }
  }

  /**
   * Builds meteor app.
   */
  async getMeteorClientBuild() {
    await this.$.meteorApp.build();
  }

  /**
   * Removes node_modules if needed.
   * @returns {Promise<void>}
   */
  async handleStateOfNodeModules() {
    if (this.$.env.isProductionBuild() || this.$.env.options.ia32) {
      if (!this.$.env.isProductionBuild()) {
        this.log.info('clearing node_modules because we need to have it clear for ia32 rebuild');
      } else {
        this.log.info('clearing node_modules because this is a production build');
      }
      try {
        await this.$.utils.rmWithRetries('-rf', this.$.env.paths.electronApp.nodeModules);
      } catch (e) {
        throw new Error(e);
      }
      return true;
    }
    return false;
  }

  /**
   * If there is a temporary node_modules folder and no node_modules folder, we will
   * restore it, as it might be a leftover from an interrupted flow.
   * @returns {Promise<void>}
   */
  async handleTemporaryNodeModules() {
    if (this.$.utils.exists(this.$.env.paths.electronApp.tmpNodeModules)) {
      if (!this.$.utils.exists(this.$.env.paths.electronApp.nodeModules)) {
        this.log.debug('moving temp node_modules back');
        _shelljs.default.mv(this.$.env.paths.electronApp.tmpNodeModules, this.$.env.paths.electronApp.nodeModules);
      } else {
        // If there is a node_modules folder, we should clear the temporary one.
        this.log.debug('clearing temp node_modules because new one is already created');
        try {
          await this.$.utils.rmWithRetries('-rf', this.$.env.paths.electronApp.tmpNodeModules);
        } catch (e) {
          throw new Error(e);
        }
      }
    }
  }

  /**
   * Runs npm link for every package specified in settings.json->linkPackages.
   */
  async linkNpmPackages() {
    if (this.$.env.isProductionBuild()) {
      return;
    }
    const settings = this.$.desktop.getSettings();
    const promises = [];
    if ('linkPackages' in this.$.desktop.getSettings()) {
      if (Array.isArray(settings.linkPackages)) {
        settings.linkPackages.forEach(packageName => promises.push(this.$.meteorApp.runNpm(['link', packageName], undefined, this.$.env.paths.electronApp.root)));
      }
    }
    await Promise.all(promises);
  }

  /**
   * Runs npm in the electron app to get the dependencies installed.
   * @returns {Promise}
   */
  async ensureDeps() {
    this.log.info('installing dependencies');
    if (this.$.utils.exists(this.$.env.paths.electronApp.nodeModules)) {
      this.log.debug('running npm prune to wipe unneeded dependencies');
      try {
        await this.runNpm(['prune']);
      } catch (e) {
        throw new Error(e);
      }
    }
    try {
      await this.runNpm(['install'], this.$.env.stdio);
    } catch (e) {
      throw new Error(e);
    }
  }

  /**
   * Warns if plugins version are outdated in compare to the newest scaffold.
   * @param {Object} pluginsVersions - current plugins versions from settings.json
   */
  checkPluginsVersion(pluginsVersions) {
    const settingsJson = JSON.parse(_fs.default.readFileSync(_path.default.join(this.$.env.paths.scaffold, 'settings.json')));
    const scaffoldPluginsVersion = this.$.desktop.getDependencies(settingsJson, false).plugins;
    Object.keys(pluginsVersions).forEach(pluginName => {
      if (pluginName in scaffoldPluginsVersion && scaffoldPluginsVersion[pluginName] !== pluginsVersions[pluginName] && _semver.default.lt(pluginsVersions[pluginName], scaffoldPluginsVersion[pluginName])) {
        this.log.warn(`you are using outdated version ${pluginsVersions[pluginName]} of ` + `${pluginName}, the suggested version to use is ` + `${scaffoldPluginsVersion[pluginName]}`);
      }
    });
  }

  /**
   * Merges core dependency list with the dependencies from .desktop.
   */
  updateDependenciesList() {
    this.log.info('updating list of package.json\'s dependencies');
    const desktopDependencies = this.$.desktop.getDependencies();
    this.checkPluginsVersion(desktopDependencies.plugins);
    this.log.debug('merging settings.json[dependencies]');
    this.depsManager.mergeDependencies('settings.json[dependencies]', desktopDependencies.fromSettings);
    this.log.debug('merging settings.json[plugins]');
    this.depsManager.mergeDependencies('settings.json[plugins]', desktopDependencies.plugins);
    this.log.debug('merging dependencies from modules');
    Object.keys(desktopDependencies.modules).forEach(module => this.depsManager.mergeDependencies(`module[${module}]`, desktopDependencies.modules[module]));
    this.packageJson.dependencies = this.depsManager.getRemoteDependencies();
    this.packageJson.localDependencies = this.depsManager.getLocalDependencies();
    this.log.debug('writing updated package.json');
    _fs.default.writeFileSync(this.$.env.paths.electronApp.packageJson, JSON.stringify(this.packageJson, null, 2));
  }

  /**
   * Install node modules from local paths using local-install.
   *
   * @param {string} arch
   * @returns {Promise}
   */
  installLocalNodeModules(arch = this.$.env.options.ia32 || process.arch === 'ia32' ? 'ia32' : 'x64') {
    const localDependencies = _lodash.default.values(this.packageJson.localDependencies);
    if (localDependencies.length === 0) {
      return Promise.resolve();
    }
    this.log.info('installing local node modules');
    const lastRebuild = this.$.electronBuilder.prepareLastRebuildObject(arch);
    const env = this.$.electronBuilder.getGypEnv(lastRebuild.frameworkInfo, lastRebuild.platform, lastRebuild.arch);
    const installer = new _installLocal.LocalInstaller({
      [this.$.env.paths.electronApp.root]: localDependencies
    }, {
      npmEnv: env
    });
    (0, _installLocal.progress)(installer);
    return installer.install();
  }

  /**
   * Rebuild binary dependencies against Electron's node headers.
   * @returns {Promise}
   */
  rebuildDeps(install = false) {
    if (install) {
      this.log.info('issuing node_modules install from electron-builder');
    } else {
      this.log.info('issuing native modules rebuild from electron-builder');
    }
    const arch = this.$.env.options.ia32 || process.arch === 'ia32' ? 'ia32' : 'x64';
    if (this.$.env.options.ia32) {
      this.log.verbose('forcing rebuild for 32bit');
    } else {
      this.log.verbose(`rebuilding for ${arch}`);
    }
    return this.$.electronBuilder.installOrRebuild(arch, undefined, install);
  }

  /**
   * Update package.json fields accordingly to what is set in settings.json.
   *
   * packageJson.name = settings.projectName
   * packageJson.version = settings.version
   * packageJson.* = settings.packageJsonFields
   */
  updatePackageJsonFields() {
    this.log.verbose('updating package.json fields');
    const settings = this.$.desktop.getSettings();
    /** @type {desktopSettings} */
    const packageJson = this.scaffold.getDefaultPackageJson();
    packageJson.version = settings.version;
    if ('packageJsonFields' in settings) {
      (0, _assignIn.default)(packageJson, settings.packageJsonFields);
    }
    (0, _assignIn.default)(packageJson, {
      name: settings.projectName
    });
    this.log.debug('writing updated package.json');
    _fs.default.writeFileSync(this.$.env.paths.electronApp.packageJson, JSON.stringify(packageJson, null, 4));
    this.packageJson = packageJson;
  }

  /**
   * Updates settings.json with env (prod/dev) information and versions.
   */
  async updateSettingsJsonFields() {
    this.log.debug('updating settings.json fields');
    const settings = this.$.desktop.getSettings();

    // Save versions.
    settings.compatibilityVersion = this.compatibilityVersion;

    // Pass information about build type to the settings.json.
    settings.env = this.$.env.isProductionBuild() ? 'prod' : 'dev';
    const version = await this.$.desktop.getHashVersion();
    settings.desktopVersion = `${version}_${settings.env}`;
    settings.meteorDesktopVersion = this.$.getVersion();
    if (this.$.env.options.prodDebug) {
      settings.prodDebug = true;
    }
    _fs.default.writeFileSync(this.$.env.paths.desktopTmp.settings, JSON.stringify(settings, null, 4));
  }

  /**
   * Copies files from prepared .desktop to desktop.asar in electron app.
   */
  packDesktopToAsar() {
    this.log.info('packing .desktop to asar');
    return new Promise((resolve, reject) => {
      _asar.default.createPackage(this.$.env.paths.desktopTmp.root, this.$.env.paths.electronApp.desktopAsar).then(() => {
        this.log.verbose('clearing temporary .desktop');
        this.$.utils.rmWithRetries('-rf', this.$.env.paths.desktopTmp.root).then(() => {
          resolve();
        }).catch(e => {
          reject(e);
        });
        resolve();
      });
    });
  }

  /**
   * Makes a temporary copy of .desktop.
   */
  copyDesktopToDesktopTemp() {
    this.log.verbose('copying .desktop to temporary location');
    _shelljs.default.cp('-rf', this.$.env.paths.desktop.root, this.$.env.paths.desktopTmp.root);
    // Remove test files.
    _del.default.sync([_path.default.join(this.$.env.paths.desktopTmp.root, '**', '*.test.js')], {
      force: true
    });
  }

  /**
   * Runs babel and uglify over .desktop if requested.
   */
  async transpileAndMinify() {
    this.log.info('transpiling and uglifying');
    const settings = this.$.desktop.getSettings();
    const options = 'uglifyOptions' in settings ? settings.uglifyOptions : {};
    const uglifyingEnabled = 'uglify' in settings && !!settings.uglify;
    const preset = (0, _presetEnv.default)({
      version: require('../package.json').dependencies['@babel/preset-env'],
      assertVersion: () => {}
    }, {
      targets: {
        node: '14'
      }
    });
    const {
      data: files
    } = await this.$.utils.readDir(this.$.env.paths.desktopTmp.root);
    files.forEach(file => {
      if (file.endsWith('.js')) {
        let {
          code
        } = (0, _core.transformFileSync)(file, {
          presets: [preset]
        });
        let error;
        if (settings.env === 'prod' && uglifyingEnabled) {
          ({
            code,
            error
          } = _terser.default.minify(code, options));
        }
        if (error) {
          throw new Error(error);
        }
        _fs.default.writeFileSync(file, code);
      }
    });
  }

  /**
   * Moves all the files that should not be packed into asar into a safe location which is the
   * 'extracted' dir in the electron app.
   */
  async excludeFilesFromArchive() {
    this.log.info('excluding files from packing');

    // Ensure empty `extracted` dir

    try {
      await this.$.utils.rmWithRetries('-rf', this.$.env.paths.electronApp.extracted);
    } catch (e) {
      throw new Error(e);
    }
    _shelljs.default.mkdir(this.$.env.paths.electronApp.extracted);
    const configs = this.$.desktop.gatherModuleConfigs();

    // Move files that should not be asar'ed.
    configs.forEach(config => {
      const moduleConfig = config;
      if ('extract' in moduleConfig) {
        if (!Array.isArray(moduleConfig.extract)) {
          moduleConfig.extract = [moduleConfig.extract];
        }
        moduleConfig.extract.forEach(file => {
          this.log.debug(`excluding ${file} from ${config.name}`);
          const filePath = _path.default.join(this.$.env.paths.desktopTmp.modules, moduleConfig.dirName, file);
          const destinationPath = _path.default.join(this.$.env.paths.electronApp.extracted, moduleConfig.dirName);
          if (!this.$.utils.exists(destinationPath)) {
            _shelljs.default.mkdir(destinationPath);
          }
          _shelljs.default.mv(filePath, destinationPath);
        });
      }
    });
  }
}
exports.default = ElectronApp;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJfcnVudGltZSIsIl9pbnRlcm9wUmVxdWlyZURlZmF1bHQiLCJyZXF1aXJlIiwiX2FzYXIiLCJfYXNzaWduSW4iLCJfbG9kYXNoIiwiX2luc3RhbGxMb2NhbCIsIl9jb3JlIiwiX2NyeXB0byIsIl9kZWwiLCJfcHJlc2V0RW52IiwiX2ZzIiwiX3BhdGgiLCJfc2hlbGxqcyIsIl9zZW12ZXIiLCJfdGVyc2VyIiwiX2xvZyIsIl9lbGVjdHJvbkFwcFNjYWZmb2xkIiwiX2RlcGVuZGVuY2llc01hbmFnZXIiLCJfYmluYXJ5TW9kdWxlc0RldGVjdG9yIiwiZSIsIl9fZXNNb2R1bGUiLCJkZWZhdWx0Iiwic2hlbGwiLCJjb25maWciLCJmYXRhbCIsIkVsZWN0cm9uQXBwIiwiY29uc3RydWN0b3IiLCIkIiwibG9nIiwiTG9nIiwic2NhZmZvbGQiLCJFbGVjdHJvbkFwcFNjYWZmb2xkIiwiZGVwc01hbmFnZXIiLCJEZXBlbmRlbmNpZXNNYW5hZ2VyIiwiZ2V0RGVmYXVsdFBhY2thZ2VKc29uIiwiZGVwZW5kZW5jaWVzIiwibWV0ZW9yQXBwIiwicGFja2FnZUpzb24iLCJ2ZXJzaW9uIiwiY29tcGF0aWJpbGl0eVZlcnNpb24iLCJkZXByZWN0YXRlZFBsdWdpbnMiLCJwYWNrU2tlbGV0b25Ub0FzYXIiLCJleGNsdWRlRnJvbURlbCIsImluZm8iLCJQcm9taXNlIiwicmVzb2x2ZSIsImV4dHJhY3QiLCJnZXRNb2R1bGVzVG9FeHRyYWN0IiwiZGVidWciLCJmcyIsInJlbmFtZVN5bmMiLCJlbnYiLCJwYXRocyIsImVsZWN0cm9uQXBwIiwibm9kZU1vZHVsZXMiLCJwYXRoIiwiam9pbiIsImFwcFJvb3QiLCJleHRyYWN0ZWQiLCJleHRyYWN0TW9kdWxlcyIsImFzYXIiLCJjcmVhdGVQYWNrYWdlIiwiYXBwQXNhciIsInRoZW4iLCJtdiIsImZvckVhY2giLCJtb2R1bGUiLCJjcCIsImV4dHJhY3RlZE5vZGVNb2R1bGVzIiwidXRpbHMiLCJleGlzdHMiLCJleHRyYWN0ZWROb2RlTW9kdWxlc0JpbiIsImV4Y2x1ZGUiLCJjb25jYXQiLCJkZWwiLCJzeW5jIiwicm9vdCIsInNlcCIsIm1hcCIsInBhdGhUb0V4Y2x1ZGUiLCJmb3JjZSIsImV4dCIsImxlbmd0aCIsInJtIiwibWtkaXJTeW5jIiwiZXh0cmFjdEJpbiIsIkpTT04iLCJwYXJzZSIsInJlYWRGaWxlU3luYyIsImJpbnMiLCJiaW4iLCJPYmplY3QiLCJrZXlzIiwiZXh0ZW5zaW9uIiwiYmluRmlsZVBhdGgiLCJzeW1saW5rRXhpc3RzIiwiYmluYXJ5TW9kdWxlc0RldGVjdG9yIiwiQmluYXJ5TW9kdWxlRGV0ZWN0b3IiLCJ0b0JlRXh0cmFjdGVkIiwiZGV0ZWN0IiwiZGVza3RvcCIsImdldFNldHRpbmdzIiwiQXJyYXkiLCJpc0FycmF5IiwibWVyZ2UiLCJ2ZXJib3NlIiwiY2FsY3VsYXRlQ29tcGF0aWJpbGl0eVZlcnNpb24iLCJzZXR0aW5ncyIsImRlc2t0b3BIQ1BDb21wYXRpYmlsaXR5VmVyc2lvbiIsIndhcm4iLCJtZDUiLCJjcnlwdG8iLCJjcmVhdGVIYXNoIiwiZ2V0RGVwZW5kZW5jaWVzIiwiZGVwZW5kZW5jaWVzU29ydGVkIiwic29ydCIsImRlcGVuZGVuY3kiLCJtYWluQ29tcGF0aWJpbGl0eVZlcnNpb24iLCJnZXRWZXJzaW9uIiwic3BsaXQiLCJwdXNoIiwiZGVza3RvcENvbXBhdGliaWxpdHlWZXJzaW9uIiwicHJvY2VzcyIsIk1FVEVPUl9ERVNLVE9QX0RFQlVHX0RFU0tUT1BfQ09NUEFUSUJJTElUWV9WRVJTSU9OIiwiTUVURU9SX0RFU0tUT1BfREVCVUciLCJzdHJpbmdpZnkiLCJ1cGRhdGUiLCJkaWdlc3QiLCJpbml0IiwiZWxlY3Ryb24iLCJlbGVjdHJvbkJ1aWxkZXIiLCJleGl0IiwiYnVpbGQiLCJydW4iLCJjaGVjayIsIm9wdGlvbnMiLCJlcnJvciIsInVwZGF0ZUdpdElnbm9yZSIsInJvb3ROYW1lIiwicmVtb3ZlRGVwcmVjYXRlZFBhY2thZ2VzIiwiZW5zdXJlRGVza3RvcEhDUFBhY2thZ2VzIiwibWFrZSIsImZpbGVOYW1lIiwiZGlyTmFtZSIsImV4aXN0c1N5bmMiLCJjb3B5RmlsZVN5bmMiLCJleHBvc2VFbGVjdHJvbk1vZHVsZXMiLCJ1cGRhdGVQYWNrYWdlSnNvbkZpZWxkcyIsInVwZGF0ZURlcGVuZGVuY2llc0xpc3QiLCJoYW5kbGVUZW1wb3JhcnlOb2RlTW9kdWxlcyIsIm5vZGVNb2R1bGVzUmVtb3ZlZCIsImhhbmRsZVN0YXRlT2ZOb2RlTW9kdWxlcyIsInJlYnVpbGREZXBzIiwibGlua05wbVBhY2thZ2VzIiwiaW5zdGFsbExvY2FsTm9kZU1vZHVsZXMiLCJlbnN1cmVNZXRlb3JEZXBlbmRlbmNpZXMiLCJpc1Byb2R1Y3Rpb25CdWlsZCIsImNvcHlEZXNrdG9wVG9EZXNrdG9wVGVtcCIsInVwZGF0ZVNldHRpbmdzSnNvbkZpZWxkcyIsImV4Y2x1ZGVGaWxlc0Zyb21BcmNoaXZlIiwidHJhbnNwaWxlQW5kTWluaWZ5IiwicGFja0Rlc2t0b3BUb0FzYXIiLCJnZXRNZXRlb3JDbGllbnRCdWlsZCIsImV4cG9zZWRNb2R1bGVzIiwicHJlbG9hZCIsIm1vZHVsZXMiLCJyZWR1Y2UiLCJwcmV2IiwicmVwbGFjZSIsIndyaXRlRmlsZVN5bmMiLCJwYWNrYWdlcyIsInBhY2thZ2VzV2l0aFZlcnNpb24iLCJwbHVnaW5zIiwicGx1Z2luIiwibWV0ZW9yRGVwZW5kZW5jaWVzIiwidW5zaGlmdCIsInBhY2thZ2VOYW1lIiwicGFja2FnZXNDb3VudCIsImZpbHRlciIsInZhbHVlIiwiaW5jbHVkZXMiLCJzdWJzdHIiLCJtZXRlb3JNYW5hZ2VyIiwiZW5zdXJlUGFja2FnZXMiLCJFcnJvciIsImlhMzIiLCJybVdpdGhSZXRyaWVzIiwidG1wTm9kZU1vZHVsZXMiLCJwcm9taXNlcyIsImxpbmtQYWNrYWdlcyIsInJ1bk5wbSIsInVuZGVmaW5lZCIsImFsbCIsImVuc3VyZURlcHMiLCJzdGRpbyIsImNoZWNrUGx1Z2luc1ZlcnNpb24iLCJwbHVnaW5zVmVyc2lvbnMiLCJzZXR0aW5nc0pzb24iLCJzY2FmZm9sZFBsdWdpbnNWZXJzaW9uIiwicGx1Z2luTmFtZSIsInNlbXZlciIsImx0IiwiZGVza3RvcERlcGVuZGVuY2llcyIsIm1lcmdlRGVwZW5kZW5jaWVzIiwiZnJvbVNldHRpbmdzIiwiZ2V0UmVtb3RlRGVwZW5kZW5jaWVzIiwibG9jYWxEZXBlbmRlbmNpZXMiLCJnZXRMb2NhbERlcGVuZGVuY2llcyIsImFyY2giLCJfIiwidmFsdWVzIiwibGFzdFJlYnVpbGQiLCJwcmVwYXJlTGFzdFJlYnVpbGRPYmplY3QiLCJnZXRHeXBFbnYiLCJmcmFtZXdvcmtJbmZvIiwicGxhdGZvcm0iLCJpbnN0YWxsZXIiLCJMb2NhbEluc3RhbGxlciIsIm5wbUVudiIsInByb2dyZXNzIiwiaW5zdGFsbCIsImluc3RhbGxPclJlYnVpbGQiLCJhc3NpZ25JbiIsInBhY2thZ2VKc29uRmllbGRzIiwibmFtZSIsInByb2plY3ROYW1lIiwiZ2V0SGFzaFZlcnNpb24iLCJkZXNrdG9wVmVyc2lvbiIsIm1ldGVvckRlc2t0b3BWZXJzaW9uIiwicHJvZERlYnVnIiwiZGVza3RvcFRtcCIsInJlamVjdCIsImRlc2t0b3BBc2FyIiwiY2F0Y2giLCJ1Z2xpZnlPcHRpb25zIiwidWdsaWZ5aW5nRW5hYmxlZCIsInVnbGlmeSIsInByZXNldCIsInByZXNldEVudiIsImFzc2VydFZlcnNpb24iLCJ0YXJnZXRzIiwibm9kZSIsImRhdGEiLCJmaWxlcyIsInJlYWREaXIiLCJmaWxlIiwiZW5kc1dpdGgiLCJjb2RlIiwidHJhbnNmb3JtRmlsZVN5bmMiLCJwcmVzZXRzIiwibWluaWZ5IiwibWtkaXIiLCJjb25maWdzIiwiZ2F0aGVyTW9kdWxlQ29uZmlncyIsIm1vZHVsZUNvbmZpZyIsImZpbGVQYXRoIiwiZGVzdGluYXRpb25QYXRoIiwiZXhwb3J0cyJdLCJzb3VyY2VzIjpbIi4uL2xpYi9lbGVjdHJvbkFwcC5qcyJdLCJzb3VyY2VzQ29udGVudCI6WyIvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgbm8tdW51c2VkLXZhcnNcbmltcG9ydCByZWdlbmVyYXRvclJ1bnRpbWUgZnJvbSAncmVnZW5lcmF0b3ItcnVudGltZS9ydW50aW1lJztcbmltcG9ydCBhc2FyIGZyb20gJ0BlbGVjdHJvbi9hc2FyJztcbmltcG9ydCBhc3NpZ25JbiBmcm9tICdsb2Rhc2gvYXNzaWduSW4nO1xuaW1wb3J0IF8gZnJvbSAnbG9kYXNoJztcbmltcG9ydCB7IExvY2FsSW5zdGFsbGVyLCBwcm9ncmVzcyB9IGZyb20gJ2luc3RhbGwtbG9jYWwnO1xuaW1wb3J0IHsgdHJhbnNmb3JtRmlsZVN5bmMgfSBmcm9tICdAYmFiZWwvY29yZSc7XG5pbXBvcnQgY3J5cHRvIGZyb20gJ2NyeXB0byc7XG5pbXBvcnQgZGVsIGZyb20gJ2RlbCc7XG5pbXBvcnQgcHJlc2V0RW52IGZyb20gJ0BiYWJlbC9wcmVzZXQtZW52JztcbmltcG9ydCBmcyBmcm9tICdmcyc7XG5pbXBvcnQgcGF0aCBmcm9tICdwYXRoJztcbmltcG9ydCBzaGVsbCBmcm9tICdzaGVsbGpzJztcbmltcG9ydCBzZW12ZXIgZnJvbSAnc2VtdmVyJztcbmltcG9ydCB1Z2xpZnkgZnJvbSAndGVyc2VyJztcblxuaW1wb3J0IExvZyBmcm9tICcuL2xvZyc7XG5pbXBvcnQgRWxlY3Ryb25BcHBTY2FmZm9sZCBmcm9tICcuL2VsZWN0cm9uQXBwU2NhZmZvbGQnO1xuaW1wb3J0IERlcGVuZGVuY2llc01hbmFnZXIgZnJvbSAnLi9kZXBlbmRlbmNpZXNNYW5hZ2VyJztcbmltcG9ydCBCaW5hcnlNb2R1bGVEZXRlY3RvciBmcm9tICcuL2JpbmFyeU1vZHVsZXNEZXRlY3Rvcic7XG5cbnNoZWxsLmNvbmZpZy5mYXRhbCA9IHRydWU7XG5cbi8qKlxuICogUmVwcmVzZW50cyB0aGUgLmRlc2t0b3AgZGlyIHNjYWZmb2xkLlxuICogQGNsYXNzXG4gKi9cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIEVsZWN0cm9uQXBwIHtcbiAgICAvKipcbiAgICAgKiBAcGFyYW0ge01ldGVvckRlc2t0b3B9ICQgLSBjb250ZXh0XG4gICAgICogQGNvbnN0cnVjdG9yXG4gICAgICovXG4gICAgY29uc3RydWN0b3IoJCkge1xuICAgICAgICB0aGlzLmxvZyA9IG5ldyBMb2coJ2VsZWN0cm9uQXBwJyk7XG4gICAgICAgIHRoaXMuc2NhZmZvbGQgPSBuZXcgRWxlY3Ryb25BcHBTY2FmZm9sZCgkKTtcbiAgICAgICAgdGhpcy5kZXBzTWFuYWdlciA9IG5ldyBEZXBlbmRlbmNpZXNNYW5hZ2VyKFxuICAgICAgICAgICAgJCxcbiAgICAgICAgICAgIHRoaXMuc2NhZmZvbGQuZ2V0RGVmYXVsdFBhY2thZ2VKc29uKCkuZGVwZW5kZW5jaWVzXG4gICAgICAgICk7XG4gICAgICAgIHRoaXMuJCA9ICQ7XG4gICAgICAgIHRoaXMubWV0ZW9yQXBwID0gdGhpcy4kLm1ldGVvckFwcDtcbiAgICAgICAgdGhpcy5wYWNrYWdlSnNvbiA9IG51bGw7XG4gICAgICAgIHRoaXMudmVyc2lvbiA9IG51bGw7XG4gICAgICAgIHRoaXMuY29tcGF0aWJpbGl0eVZlcnNpb24gPSBudWxsO1xuICAgICAgICB0aGlzLmRlcHJlY3RhdGVkUGx1Z2lucyA9IFsnbWV0ZW9yLWRlc2t0b3AtbG9jYWxzdG9yYWdlJ107XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogTWFrZXMgYW4gYXBwLmFzYXIgZnJvbSB0aGUgc2tlbGV0b24gYXBwLlxuICAgICAqIEBwcm9wZXJ0eSB7QXJyYXl9IGV4Y2x1ZGVGcm9tRGVsIC0gbGlzdCBvZiBwYXRocyB0byBleGNsdWRlIGZyb20gZGVsZXRpbmdcbiAgICAgKiBAcmV0dXJucyB7UHJvbWlzZX1cbiAgICAgKi9cbiAgICBwYWNrU2tlbGV0b25Ub0FzYXIoZXhjbHVkZUZyb21EZWwgPSBbXSkge1xuICAgICAgICB0aGlzLmxvZy5pbmZvKCdwYWNraW5nIHNrZWxldG9uIGFwcCBhbmQgbm9kZV9tb2R1bGVzIHRvIGFzYXIgYXJjaGl2ZScpO1xuICAgICAgICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IGV4dHJhY3QgPSB0aGlzLmdldE1vZHVsZXNUb0V4dHJhY3QoKTtcblxuICAgICAgICAgICAgLy8gV2Ugd2FudCB0byBwYWNrIHNrZWxldG9uIGFwcCBhbmQgbm9kZV9tb2R1bGVzIHRvZ2V0aGVyLCBzbyB3ZSBuZWVkIHRvIHRlbXBvcmFyaWx5XG4gICAgICAgICAgICAvLyBtb3ZlIG5vZGVfbW9kdWxlcyB0byBhcHAgZGlyLlxuICAgICAgICAgICAgdGhpcy5sb2cuZGVidWcoJ21vdmluZyBub2RlX21vZHVsZXMgdG8gYXBwIGRpcicpO1xuXG4gICAgICAgICAgICBmcy5yZW5hbWVTeW5jKFxuICAgICAgICAgICAgICAgIHRoaXMuJC5lbnYucGF0aHMuZWxlY3Ryb25BcHAubm9kZU1vZHVsZXMsXG4gICAgICAgICAgICAgICAgcGF0aC5qb2luKHRoaXMuJC5lbnYucGF0aHMuZWxlY3Ryb25BcHAuYXBwUm9vdCwgJ25vZGVfbW9kdWxlcycpXG4gICAgICAgICAgICApO1xuXG4gICAgICAgICAgICBsZXQgZXh0cmFjdGVkID0gZmFsc2U7XG4gICAgICAgICAgICBleHRyYWN0ZWQgPSB0aGlzLmV4dHJhY3RNb2R1bGVzKGV4dHJhY3QpO1xuXG4gICAgICAgICAgICB0aGlzLmxvZy5kZWJ1ZygncGFja2luZycpO1xuICAgICAgICAgICAgYXNhci5jcmVhdGVQYWNrYWdlKFxuICAgICAgICAgICAgICAgIHRoaXMuJC5lbnYucGF0aHMuZWxlY3Ryb25BcHAuYXBwUm9vdCxcbiAgICAgICAgICAgICAgICB0aGlzLiQuZW52LnBhdGhzLmVsZWN0cm9uQXBwLmFwcEFzYXJcbiAgICAgICAgICAgIClcbiAgICAgICAgICAgICAgICAudGhlbigoKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgIC8vIExldHMgbW92ZSB0aGUgbm9kZV9tb2R1bGVzIGJhY2suXG4gICAgICAgICAgICAgICAgICAgIHRoaXMubG9nLmRlYnVnKCdtb3Zpbmcgbm9kZV9tb2R1bGVzIGJhY2sgZnJvbSBhcHAgZGlyJyk7XG5cbiAgICAgICAgICAgICAgICAgICAgc2hlbGwubXYoXG4gICAgICAgICAgICAgICAgICAgICAgICBwYXRoLmpvaW4odGhpcy4kLmVudi5wYXRocy5lbGVjdHJvbkFwcC5hcHBSb290LCAnbm9kZV9tb2R1bGVzJyksXG4gICAgICAgICAgICAgICAgICAgICAgICB0aGlzLiQuZW52LnBhdGhzLmVsZWN0cm9uQXBwLm5vZGVNb2R1bGVzXG4gICAgICAgICAgICAgICAgICAgICk7XG5cbiAgICAgICAgICAgICAgICAgICAgaWYgKGV4dHJhY3RlZCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgLy8gV2UgbmVlZCB0byBjcmVhdGUgYSBmdWxsIG5vZGUgbW9kdWxlcyBiYWNrLiBJbiBvdGhlciB3b3JkcyB3ZSB3YW50XG4gICAgICAgICAgICAgICAgICAgICAgICAvLyB0aGUgZXh0cmFjdGVkIG1vZHVsZXMgYmFjay5cbiAgICAgICAgICAgICAgICAgICAgICAgIGV4dHJhY3QuZm9yRWFjaChtb2R1bGUgPT4gc2hlbGwuY3AoXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgJy1yZicsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgcGF0aC5qb2luKHRoaXMuJC5lbnYucGF0aHMuZWxlY3Ryb25BcHAuZXh0cmFjdGVkTm9kZU1vZHVsZXMsIG1vZHVsZSksXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgcGF0aC5qb2luKHRoaXMuJC5lbnYucGF0aHMuZWxlY3Ryb25BcHAubm9kZU1vZHVsZXMsIG1vZHVsZSlcbiAgICAgICAgICAgICAgICAgICAgICAgICkpO1xuXG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBHZXQgdGhlIC5iaW4gYmFjay5cbiAgICAgICAgICAgICAgICAgICAgICAgIGlmICh0aGlzLiQudXRpbHMuZXhpc3RzKFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuJC5lbnYucGF0aHMuZWxlY3Ryb25BcHAuZXh0cmFjdGVkTm9kZU1vZHVsZXNCaW5cbiAgICAgICAgICAgICAgICAgICAgICAgICkpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBzaGVsbC5jcChcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcGF0aC5qb2luKHRoaXMuJC5lbnYucGF0aHMuZWxlY3Ryb25BcHAuZXh0cmFjdGVkTm9kZU1vZHVsZXNCaW4sICcqJyksXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHBhdGguam9pbih0aGlzLiQuZW52LnBhdGhzLmVsZWN0cm9uQXBwLm5vZGVNb2R1bGVzLCAnLmJpbicpXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgICAgIHRoaXMubG9nLmRlYnVnKCdkZWxldGluZyBzb3VyY2UgZmlsZXMnKTtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgZXhjbHVkZSA9IFt0aGlzLiQuZW52LnBhdGhzLmVsZWN0cm9uQXBwLm5vZGVNb2R1bGVzXS5jb25jYXQoXG4gICAgICAgICAgICAgICAgICAgICAgICBbXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy4kLmVudi5wYXRocy5lbGVjdHJvbkFwcC5hcHBBc2FyLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuJC5lbnYucGF0aHMuZWxlY3Ryb25BcHAucGFja2FnZUpzb25cbiAgICAgICAgICAgICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICAgICAgICAgICAgICBleGNsdWRlRnJvbURlbFxuICAgICAgICAgICAgICAgICAgICApO1xuXG4gICAgICAgICAgICAgICAgICAgIGRlbC5zeW5jKFxuICAgICAgICAgICAgICAgICAgICAgICAgW2Ake3RoaXMuJC5lbnYucGF0aHMuZWxlY3Ryb25BcHAucm9vdH0ke3BhdGguc2VwfSpgXS5jb25jYXQoXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZXhjbHVkZS5tYXAocGF0aFRvRXhjbHVkZSA9PiBgISR7cGF0aFRvRXhjbHVkZX1gKVxuICAgICAgICAgICAgICAgICAgICAgICAgKSxcbiAgICAgICAgICAgICAgICAgICAgICAgIHsgZm9yY2U6IHRydWUgfVxuICAgICAgICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgICAgICAgICByZXNvbHZlKCk7XG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIE1vdmVzIHNwZWNpZmllZCBub2RlIG1vZHVsZXMgdG8gYSBzZXBhcmF0ZSBkaXJlY3RvcnkuXG4gICAgICogQHBhcmFtIHtBcnJheX0gZXh0cmFjdFxuICAgICAqIEByZXR1cm5zIHtib29sZWFufVxuICAgICAqL1xuICAgIGV4dHJhY3RNb2R1bGVzKGV4dHJhY3QpIHtcbiAgICAgICAgY29uc3QgZXh0ID0gWycuanMnLCAnLmJhdCcsICcuc2gnLCAnLmNtZCcsICcnXTtcblxuICAgICAgICBpZiAoZXh0cmFjdC5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgICBpZiAodGhpcy4kLnV0aWxzLmV4aXN0cyh0aGlzLiQuZW52LnBhdGhzLmVsZWN0cm9uQXBwLmV4dHJhY3RlZE5vZGVNb2R1bGVzKSkge1xuICAgICAgICAgICAgICAgIHNoZWxsLnJtKCctcmYnLCB0aGlzLiQuZW52LnBhdGhzLmVsZWN0cm9uQXBwLmV4dHJhY3RlZE5vZGVNb2R1bGVzKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGZzLm1rZGlyU3luYyh0aGlzLiQuZW52LnBhdGhzLmVsZWN0cm9uQXBwLmV4dHJhY3RlZE5vZGVNb2R1bGVzKTtcbiAgICAgICAgICAgIGZzLm1rZGlyU3luYyh0aGlzLiQuZW52LnBhdGhzLmVsZWN0cm9uQXBwLmV4dHJhY3RlZE5vZGVNb2R1bGVzQmluKTtcblxuICAgICAgICAgICAgZXh0cmFjdC5mb3JFYWNoKChtb2R1bGUpID0+IHtcbiAgICAgICAgICAgICAgICBmcy5yZW5hbWVTeW5jKFxuICAgICAgICAgICAgICAgICAgICBwYXRoLmpvaW4odGhpcy4kLmVudi5wYXRocy5lbGVjdHJvbkFwcC5hcHBSb290LCAnbm9kZV9tb2R1bGVzJywgbW9kdWxlKSxcbiAgICAgICAgICAgICAgICAgICAgcGF0aC5qb2luKHRoaXMuJC5lbnYucGF0aHMuZWxlY3Ryb25BcHAuZXh0cmFjdGVkTm9kZU1vZHVsZXMsIG1vZHVsZSksXG4gICAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgICAgICAvLyBNb3ZlIGJpbnMuXG4gICAgICAgICAgICAgICAgdGhpcy5leHRyYWN0QmluKG1vZHVsZSwgZXh0KTtcbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogRXh0cmFjdHMgdGhlIGJpbiBmaWxlcyBhc3NvY2lhdGVkIHdpdGggYSBjZXJ0YWluIG5vZGUgbW9kdWxlcy5cbiAgICAgKlxuICAgICAqIEBwYXJhbSBtb2R1bGVcbiAgICAgKiBAcGFyYW0gZXh0XG4gICAgICovXG4gICAgZXh0cmFjdEJpbihtb2R1bGUsIGV4dCkge1xuICAgICAgICBsZXQgcGFja2FnZUpzb247XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICBwYWNrYWdlSnNvbiA9IEpTT04ucGFyc2UoXG4gICAgICAgICAgICAgICAgZnMucmVhZEZpbGVTeW5jKFxuICAgICAgICAgICAgICAgICAgICBwYXRoLmpvaW4oXG4gICAgICAgICAgICAgICAgICAgICAgICB0aGlzLiQuZW52LnBhdGhzLmVsZWN0cm9uQXBwLmV4dHJhY3RlZE5vZGVNb2R1bGVzLCBtb2R1bGUsICdwYWNrYWdlLmpzb24nXG4gICAgICAgICAgICAgICAgICAgICksXG4gICAgICAgICAgICAgICAgICAgICd1dGY4J1xuICAgICAgICAgICAgICAgIClcbiAgICAgICAgICAgICk7XG4gICAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgICAgIHBhY2thZ2VKc29uID0ge307XG4gICAgICAgIH1cblxuXG4gICAgICAgIGNvbnN0IGJpbnMgPSAoJ2JpbicgaW4gcGFja2FnZUpzb24gJiYgdHlwZW9mIHBhY2thZ2VKc29uLmJpbiA9PT0gJ29iamVjdCcpID8gT2JqZWN0LmtleXMocGFja2FnZUpzb24uYmluKSA6IFtdO1xuXG4gICAgICAgIGlmIChiaW5zLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICAgIGJpbnMuZm9yRWFjaCgoYmluKSA9PiB7XG4gICAgICAgICAgICAgICAgZXh0LmZvckVhY2goKGV4dGVuc2lvbikgPT4ge1xuICAgICAgICAgICAgICAgICAgICBjb25zdCBiaW5GaWxlUGF0aCA9IHBhdGguam9pbihcbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuJC5lbnYucGF0aHMuZWxlY3Ryb25BcHAuYXBwUm9vdCxcbiAgICAgICAgICAgICAgICAgICAgICAgICdub2RlX21vZHVsZXMnLFxuICAgICAgICAgICAgICAgICAgICAgICAgJy5iaW4nLFxuICAgICAgICAgICAgICAgICAgICAgICAgYCR7YmlufSR7ZXh0ZW5zaW9ufWBcbiAgICAgICAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgICAgICAgICAgaWYgKHRoaXMuJC51dGlscy5leGlzdHMoYmluRmlsZVBhdGgpIHx8XG4gICAgICAgICAgICAgICAgICAgICAgICB0aGlzLiQudXRpbHMuc3ltbGlua0V4aXN0cyhiaW5GaWxlUGF0aClcbiAgICAgICAgICAgICAgICAgICAgKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBmcy5yZW5hbWVTeW5jKFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGJpbkZpbGVQYXRoLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHBhdGguam9pbihcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy4kLmVudi5wYXRocy5lbGVjdHJvbkFwcC5leHRyYWN0ZWROb2RlTW9kdWxlc0JpbixcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgYCR7YmlufSR7ZXh0ZW5zaW9ufWBcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICApXG4gICAgICAgICAgICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIC8qKlxuICAgICAqIE1lcmdlcyB0aGUgYGV4dHJhY3RgIGZpZWxkIHdpdGggYXV0b21hdGljYWxseSBkZXRlY3RlZCBtb2R1bGVzLlxuICAgICAqL1xuICAgIGdldE1vZHVsZXNUb0V4dHJhY3QoKSB7XG4gICAgICAgIGNvbnN0IGJpbmFyeU1vZHVsZXNEZXRlY3RvciA9XG4gICAgICAgICAgICBuZXcgQmluYXJ5TW9kdWxlRGV0ZWN0b3IodGhpcy4kLmVudi5wYXRocy5lbGVjdHJvbkFwcC5ub2RlTW9kdWxlcyk7XG4gICAgICAgIGNvbnN0IHRvQmVFeHRyYWN0ZWQgPSBiaW5hcnlNb2R1bGVzRGV0ZWN0b3IuZGV0ZWN0KCk7XG5cbiAgICAgICAgbGV0IHsgZXh0cmFjdCB9ID0gdGhpcy4kLmRlc2t0b3AuZ2V0U2V0dGluZ3MoKTtcblxuICAgICAgICBpZiAoIUFycmF5LmlzQXJyYXkoZXh0cmFjdCkpIHtcbiAgICAgICAgICAgIGV4dHJhY3QgPSBbXTtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IG1lcmdlID0ge307XG4gICAgICAgIHRvQmVFeHRyYWN0ZWQuY29uY2F0KGV4dHJhY3QpLmZvckVhY2goKG1vZHVsZSkgPT4ge1xuICAgICAgICAgICAgbWVyZ2VbbW9kdWxlXSA9IHRydWU7XG4gICAgICAgIH0pO1xuICAgICAgICBleHRyYWN0ID0gT2JqZWN0LmtleXMobWVyZ2UpO1xuICAgICAgICBpZiAoZXh0cmFjdC5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgICB0aGlzLmxvZy52ZXJib3NlKGByZXN1bHRhbnQgbW9kdWxlcyB0byBleHRyYWN0IGxpc3QgaXM6ICR7ZXh0cmFjdC5qb2luKCcsICcpfWApO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBleHRyYWN0O1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIENhbGN1bGF0ZXMgYSBtZDUgZnJvbSBhbGwgZGVwZW5kZW5jaWVzLlxuICAgICAqL1xuICAgIGNhbGN1bGF0ZUNvbXBhdGliaWxpdHlWZXJzaW9uKCkge1xuICAgICAgICB0aGlzLmxvZy52ZXJib3NlKCdjYWxjdWxhdGluZyBjb21wYXRpYmlsaXR5IHZlcnNpb24nKTtcbiAgICAgICAgY29uc3Qgc2V0dGluZ3MgPSB0aGlzLiQuZGVza3RvcC5nZXRTZXR0aW5ncygpO1xuXG4gICAgICAgIGlmICgoJ2Rlc2t0b3BIQ1BDb21wYXRpYmlsaXR5VmVyc2lvbicgaW4gc2V0dGluZ3MpKSB7XG4gICAgICAgICAgICB0aGlzLmNvbXBhdGliaWxpdHlWZXJzaW9uID0gYCR7c2V0dGluZ3MuZGVza3RvcEhDUENvbXBhdGliaWxpdHlWZXJzaW9ufWA7XG4gICAgICAgICAgICB0aGlzLmxvZy53YXJuKGBjb21wYXRpYmlsaXR5IHZlcnNpb24gb3ZlcnJpZGRlbiB0byAke3RoaXMuY29tcGF0aWJpbGl0eVZlcnNpb259YCk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBtZDUgPSBjcnlwdG8uY3JlYXRlSGFzaCgnbWQ1Jyk7XG4gICAgICAgIGxldCBkZXBlbmRlbmNpZXMgPSB0aGlzLmRlcHNNYW5hZ2VyLmdldERlcGVuZGVuY2llcygpO1xuICAgICAgICBjb25zdCBkZXBlbmRlbmNpZXNTb3J0ZWQgPSBPYmplY3Qua2V5cyhkZXBlbmRlbmNpZXMpLnNvcnQoKTtcbiAgICAgICAgZGVwZW5kZW5jaWVzID0gZGVwZW5kZW5jaWVzU29ydGVkLm1hcChkZXBlbmRlbmN5ID0+XG4gICAgICAgICAgICBgJHtkZXBlbmRlbmN5fToke2RlcGVuZGVuY2llc1tkZXBlbmRlbmN5XX1gKTtcbiAgICAgICAgY29uc3QgbWFpbkNvbXBhdGliaWxpdHlWZXJzaW9uID0gdGhpcy4kLmdldFZlcnNpb24oKS5zcGxpdCgnLicpO1xuICAgICAgICB0aGlzLmxvZy5kZWJ1ZygnbWV0ZW9yLWRlc2t0b3AgY29tcGF0aWJpbGl0eSB2ZXJzaW9uIGlzICcsXG4gICAgICAgICAgICBgJHttYWluQ29tcGF0aWJpbGl0eVZlcnNpb25bMF19YCk7XG4gICAgICAgIGRlcGVuZGVuY2llcy5wdXNoKFxuICAgICAgICAgICAgYG1ldGVvci1kZXNrdG9wOiR7bWFpbkNvbXBhdGliaWxpdHlWZXJzaW9uWzBdfWBcbiAgICAgICAgKTtcblxuICAgICAgICBjb25zdCBkZXNrdG9wQ29tcGF0aWJpbGl0eVZlcnNpb24gPSBzZXR0aW5ncy52ZXJzaW9uLnNwbGl0KCcuJylbMF07XG4gICAgICAgIHRoaXMubG9nLmRlYnVnKCcuZGVza3RvcCBjb21wYXRpYmlsaXR5IHZlcnNpb24gaXMgJywgZGVza3RvcENvbXBhdGliaWxpdHlWZXJzaW9uKTtcbiAgICAgICAgZGVwZW5kZW5jaWVzLnB1c2goXG4gICAgICAgICAgICBgZGVza3RvcC1hcHA6JHtkZXNrdG9wQ29tcGF0aWJpbGl0eVZlcnNpb259YFxuICAgICAgICApO1xuXG4gICAgICAgIGlmIChwcm9jZXNzLmVudi5NRVRFT1JfREVTS1RPUF9ERUJVR19ERVNLVE9QX0NPTVBBVElCSUxJVFlfVkVSU0lPTiB8fFxuICAgICAgICAgICAgcHJvY2Vzcy5lbnYuTUVURU9SX0RFU0tUT1BfREVCVUdcbiAgICAgICAgKSB7XG4gICAgICAgICAgICB0aGlzLmxvZy5kZWJ1ZyhgY29tcGF0aWJpbGl0eSB2ZXJzaW9uIGNhbGN1bGF0ZWQgZnJvbSAke0pTT04uc3RyaW5naWZ5KGRlcGVuZGVuY2llcyl9YCk7XG4gICAgICAgIH1cblxuICAgICAgICBtZDUudXBkYXRlKEpTT04uc3RyaW5naWZ5KGRlcGVuZGVuY2llcykpO1xuXG4gICAgICAgIHRoaXMuY29tcGF0aWJpbGl0eVZlcnNpb24gPSBtZDUuZGlnZXN0KCdoZXgnKTtcbiAgICB9XG5cbiAgICBhc3luYyBpbml0KCkge1xuICAgICAgICB0cnkge1xuICAgICAgICAgICAgYXdhaXQgdGhpcy4kLmVsZWN0cm9uLmluaXQoKTtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMuJC5lbGVjdHJvbkJ1aWxkZXIuaW5pdCgpO1xuICAgICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgICAgICB0aGlzLmxvZy53YXJuKCdlcnJvciBvY2N1cnJlZCB3aGlsZSBpbml0aWFsaXNpbmcgZWxlY3Ryb24gYW5kIGVsZWN0cm9uLWJ1aWxkZXIgaW50ZWdyYXRpb24nLCBlKTtcbiAgICAgICAgICAgIHByb2Nlc3MuZXhpdCgxKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIC8qKlxuICAgICAqIFJ1bnMgYWxsIG5lY2Vzc2FyeSB0YXNrcyB0byBidWlsZCB0aGUgZGVza3RvcGlmaWVkIGFwcC5cbiAgICAgKi9cbiAgICBhc3luYyBidWlsZChydW4gPSBmYWxzZSkge1xuICAgICAgICAvLyBUT0RPOiByZWZhY3RvciB0byBhIHRhc2sgcnVubmVyXG4gICAgICAgIHRoaXMubG9nLmluZm8oJ3NjYWZmb2xkaW5nJyk7XG5cbiAgICAgICAgaWYgKCF0aGlzLiQuZGVza3RvcC5jaGVjaygpKSB7XG4gICAgICAgICAgICBpZiAoIXRoaXMuJC5lbnYub3B0aW9ucy5zY2FmZm9sZCkge1xuICAgICAgICAgICAgICAgIHRoaXMubG9nLmVycm9yKCdzZWVtcyB0aGF0IHlvdSBkbyBub3QgaGF2ZSBhIC5kZXNrdG9wIGRpciBpbiB5b3VyIHByb2plY3Qgb3IgaXQgaXMnICtcbiAgICAgICAgICAgICAgICAgICAgJyBjb3JydXB0ZWQuIFJ1biBcXCducG0gcnVuIGRlc2t0b3AgLS0gaW5pdFxcJyB0byBnZXQgYSBuZXcgb25lLicpO1xuICAgICAgICAgICAgICAgIC8vIERvIG5vdCBmYWlsLCBzbyB0aGF0IG5wbSB3aWxsIG5vdCBwcmludCBoaXMgZXJyb3Igc3R1ZmYgdG8gY29uc29sZS5cbiAgICAgICAgICAgICAgICBwcm9jZXNzLmV4aXQoMCk7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIHRoaXMuJC5kZXNrdG9wLnNjYWZmb2xkKCk7XG4gICAgICAgICAgICAgICAgdGhpcy4kLm1ldGVvckFwcC51cGRhdGVHaXRJZ25vcmUoKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIGF3YWl0IHRoaXMuaW5pdCgpO1xuXG5cbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIHRoaXMuJC5tZXRlb3JBcHAudXBkYXRlR2l0SWdub3JlKCk7XG4gICAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgICAgIHRoaXMubG9nLndhcm4oYGVycm9yIG9jY3VycmVkIHdoaWxlIGFkZGluZyAke3RoaXMuJC5lbnYucGF0aHMuZWxlY3Ryb25BcHAucm9vdE5hbWV9YCArXG4gICAgICAgICAgICAgICAgJ3RvIC5naXRpZ25vcmU6ICcsIGUpO1xuICAgICAgICB9XG5cbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMuJC5tZXRlb3JBcHAucmVtb3ZlRGVwcmVjYXRlZFBhY2thZ2VzKCk7XG4gICAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgICAgIHRoaXMubG9nLmVycm9yKCdlcnJvciB3aGlsZSByZW1vdmluZyBkZXByZWNhdGVkIHBhY2thZ2VzOiAnLCBlKTtcbiAgICAgICAgICAgIHByb2Nlc3MuZXhpdCgxKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLiQubWV0ZW9yQXBwLmVuc3VyZURlc2t0b3BIQ1BQYWNrYWdlcygpO1xuICAgICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgICAgICB0aGlzLmxvZy5lcnJvcignZXJyb3Igd2hpbGUgY2hlY2tpbmcgZm9yIHJlcXVpcmVkIHBhY2thZ2VzOiAnLCBlKTtcbiAgICAgICAgICAgIHByb2Nlc3MuZXhpdCgxKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLnNjYWZmb2xkLm1ha2UoKTtcbiAgICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICAgICAgdGhpcy5sb2cuZXJyb3IoJ2Vycm9yIHdoaWxlIHNjYWZmb2xkaW5nOiAnLCBlKTtcbiAgICAgICAgICAgIHByb2Nlc3MuZXhpdCgxKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICBjb25zdCBmaWxlTmFtZSA9ICcubnBtcmMnO1xuICAgICAgICAgICAgY29uc3QgZGlyTmFtZSA9ICcubWV0ZW9yL2Rlc2t0b3AtYnVpbGQnO1xuICAgICAgICAgICAgaWYgKGZzLmV4aXN0c1N5bmMoZGlyTmFtZSkgJiYgZnMuZXhpc3RzU3luYyhmaWxlTmFtZSkpIHtcbiAgICAgICAgICAgICAgICBmcy5jb3B5RmlsZVN5bmMoZmlsZU5hbWUsIGAke2Rpck5hbWV9LyR7ZmlsZU5hbWV9YCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgICAgIHRoaXMubG9nLndhcm4oJ2Vycm9yIHdoaWxlIGNvcHlpbmcgLm5wbXJjJywgZSk7XG4gICAgICAgIH1cblxuICAgICAgICB0cnkge1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5leHBvc2VFbGVjdHJvbk1vZHVsZXMoKTtcbiAgICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICAgICAgdGhpcy5sb2cuZXJyb3IoJ2Vycm9yIHdoaWxlIGV4cG9zaW5nIGVsZWN0cm9uIG1vZHVsZXM6ICcsIGUpO1xuICAgICAgICAgICAgcHJvY2Vzcy5leGl0KDEpO1xuICAgICAgICB9XG5cbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIHRoaXMudXBkYXRlUGFja2FnZUpzb25GaWVsZHMoKTtcbiAgICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICAgICAgdGhpcy5sb2cuZXJyb3IoJ2Vycm9yIHdoaWxlIHVwZGF0aW5nIHBhY2thZ2UuanNvbjogJywgZSk7XG4gICAgICAgIH1cblxuICAgICAgICB0cnkge1xuICAgICAgICAgICAgdGhpcy51cGRhdGVEZXBlbmRlbmNpZXNMaXN0KCk7XG4gICAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgICAgIHRoaXMubG9nLmVycm9yKCdlcnJvciB3aGlsZSBtZXJnaW5nIGRlcGVuZGVuY2llcyBsaXN0OiAnLCBlKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICB0aGlzLmNhbGN1bGF0ZUNvbXBhdGliaWxpdHlWZXJzaW9uKCk7XG4gICAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgICAgIHRoaXMubG9nLmVycm9yKCdlcnJvciB3aGlsZSBjYWxjdWxhdGluZyBjb21wYXRpYmlsaXR5IHZlcnNpb246ICcsIGUpO1xuICAgICAgICAgICAgcHJvY2Vzcy5leGl0KDEpO1xuICAgICAgICB9XG5cbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMuaGFuZGxlVGVtcG9yYXJ5Tm9kZU1vZHVsZXMoKTtcbiAgICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICAgICAgdGhpcy5sb2cuZXJyb3IoJ2Vycm9yIG9jY3VycmVkIHdoaWxlIGhhbmRsaW5nIHRlbXBvcmFyeSBub2RlX21vZHVsZXM6ICcsIGUpO1xuICAgICAgICAgICAgcHJvY2Vzcy5leGl0KDEpO1xuICAgICAgICB9XG5cbiAgICAgICAgbGV0IG5vZGVNb2R1bGVzUmVtb3ZlZDtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIG5vZGVNb2R1bGVzUmVtb3ZlZCA9IGF3YWl0IHRoaXMuaGFuZGxlU3RhdGVPZk5vZGVNb2R1bGVzKCk7XG4gICAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgICAgIHRoaXMubG9nLmVycm9yKCdlcnJvciBvY2N1cnJlZCB3aGlsZSBjbGVhcmluZyBub2RlX21vZHVsZXM6ICcsIGUpO1xuICAgICAgICAgICAgcHJvY2Vzcy5leGl0KDEpO1xuICAgICAgICB9XG5cbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMucmVidWlsZERlcHModHJ1ZSk7XG4gICAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgICAgIHRoaXMubG9nLmVycm9yKCdlcnJvciBvY2N1cnJlZCB3aGlsZSBpbnN0YWxsaW5nIG5vZGVfbW9kdWxlczogJywgZSk7XG4gICAgICAgICAgICBwcm9jZXNzLmV4aXQoMSk7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoIW5vZGVNb2R1bGVzUmVtb3ZlZCkge1xuICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICBhd2FpdCB0aGlzLnJlYnVpbGREZXBzKCk7XG4gICAgICAgICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5sb2cuZXJyb3IoJ2Vycm9yIG9jY3VycmVkIHdoaWxlIHJlYnVpbGRpbmcgbmF0aXZlIG5vZGUgbW9kdWxlczogJywgZSk7XG4gICAgICAgICAgICAgICAgcHJvY2Vzcy5leGl0KDEpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMubGlua05wbVBhY2thZ2VzKCk7XG4gICAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgICAgIHRoaXMubG9nLmVycm9yKGBsaW5raW5nIHBhY2thZ2VzIGZhaWxlZDogJHtlfWApO1xuICAgICAgICAgICAgcHJvY2Vzcy5leGl0KDEpO1xuICAgICAgICB9XG5cbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMuaW5zdGFsbExvY2FsTm9kZU1vZHVsZXMoKTtcbiAgICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICAgICAgdGhpcy5sb2cuZXJyb3IoJ2Vycm9yIG9jY3VycmVkIHdoaWxlIGluc3RhbGxpbmcgbG9jYWwgbm9kZSBtb2R1bGVzOiAnLCBlKTtcbiAgICAgICAgICAgIHByb2Nlc3MuZXhpdCgxKTtcbiAgICAgICAgfVxuXG5cbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMuZW5zdXJlTWV0ZW9yRGVwZW5kZW5jaWVzKCk7XG4gICAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgICAgIHRoaXMubG9nLmVycm9yKCdlcnJvciBvY2N1cnJlZCB3aGlsZSBlbnN1cmluZyBtZXRlb3IgZGVwZW5kZW5jaWVzIGFyZSBpbnN0YWxsZWQ6ICcsIGUpO1xuICAgICAgICAgICAgcHJvY2Vzcy5leGl0KDEpO1xuICAgICAgICB9XG5cblxuICAgICAgICBpZiAodGhpcy4kLmVudi5pc1Byb2R1Y3Rpb25CdWlsZCgpKSB7XG4gICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgIGF3YWl0IHRoaXMucGFja1NrZWxldG9uVG9Bc2FyKCk7XG4gICAgICAgICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5sb2cuZXJyb3IoJ2Vycm9yIHdoaWxlIHBhY2tpbmcgc2tlbGV0b24gdG8gYXNhcjogJywgZSk7XG4gICAgICAgICAgICAgICAgcHJvY2Vzcy5leGl0KDEpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgLy8gVE9ETzogZmluZCBhIHdheSB0byBhdm9pZCBjb3B5aW5nIC5kZXNrdG9wIHRvIGEgdGVtcCBsb2NhdGlvblxuICAgICAgICB0cnkge1xuICAgICAgICAgICAgdGhpcy5jb3B5RGVza3RvcFRvRGVza3RvcFRlbXAoKTtcbiAgICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICAgICAgdGhpcy5sb2cuZXJyb3IoJ2Vycm9yIHdoaWxlIGNvcHlpbmcgLmRlc2t0b3AgdG8gYSB0ZW1wb3JhcnkgbG9jYXRpb246ICcsIGUpO1xuICAgICAgICAgICAgcHJvY2Vzcy5leGl0KDEpO1xuICAgICAgICB9XG5cbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMudXBkYXRlU2V0dGluZ3NKc29uRmllbGRzKCk7XG4gICAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgICAgIHRoaXMubG9nLmVycm9yKCdlcnJvciB3aGlsZSB1cGRhdGluZyBzZXR0aW5ncy5qc29uOiAnLCBlKTtcbiAgICAgICAgICAgIHByb2Nlc3MuZXhpdCgxKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLmV4Y2x1ZGVGaWxlc0Zyb21BcmNoaXZlKCk7XG4gICAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgICAgIHRoaXMubG9nLmVycm9yKCdlcnJvciB3aGlsZSBleGNsdWRpbmcgZmlsZXMgZnJvbSBwYWNraW5nIHRvIGFzYXI6ICcsIGUpO1xuICAgICAgICAgICAgcHJvY2Vzcy5leGl0KDEpO1xuICAgICAgICB9XG5cbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMudHJhbnNwaWxlQW5kTWluaWZ5KCk7XG4gICAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgICAgIHRoaXMubG9nLmVycm9yKCdlcnJvciB3aGlsZSB0cmFuc3BpbGluZyBvciBtaW5pZnlpbmc6ICcsIGUpO1xuICAgICAgICB9XG5cbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMucGFja0Rlc2t0b3BUb0FzYXIoKTtcbiAgICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICAgICAgdGhpcy5sb2cuZXJyb3IoJ2Vycm9yIG9jY3VycmVkIHdoaWxlIHBhY2tpbmcgLmRlc2t0b3AgdG8gYXNhcjogJywgZSk7XG4gICAgICAgICAgICBwcm9jZXNzLmV4aXQoMSk7XG4gICAgICAgIH1cblxuICAgICAgICB0cnkge1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5nZXRNZXRlb3JDbGllbnRCdWlsZCgpO1xuICAgICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgICAgICB0aGlzLmxvZy5lcnJvcignZXJyb3Igb2NjdXJyZWQgZHVyaW5nIGdldHRpbmcgbWV0ZW9yIG1vYmlsZSBidWlsZDogJywgZSk7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAocnVuKSB7XG4gICAgICAgICAgICB0aGlzLmxvZy5pbmZvKCdydW5uaW5nJyk7XG4gICAgICAgICAgICB0aGlzLiQuZWxlY3Ryb24ucnVuKCk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICB0aGlzLmxvZy5pbmZvKCdidWlsdCcpO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogQ29waWVzIHRoZSBgZXhwb3NlZE1vZHVsZXNgIHNldHRpbmcgZnJvbSBgc2V0dGluZ3MuanNvbmAgaW50byBgcHJlbG9hZC5qc2AgbW9kaWZ5aW5nIGl0cyBjb2RlXG4gICAgICogc28gdGhhdCB0aGUgc2NyaXB0IHdpbGwgaGF2ZSBpdCBoYXJkY29kZWQuXG4gICAgICovXG4gICAgZXhwb3NlRWxlY3Ryb25Nb2R1bGVzKCkge1xuICAgICAgICBjb25zdCB7IGV4cG9zZWRNb2R1bGVzIH0gPSB0aGlzLiQuZGVza3RvcC5nZXRTZXR0aW5ncygpO1xuICAgICAgICBpZiAoZXhwb3NlZE1vZHVsZXMgJiYgQXJyYXkuaXNBcnJheShleHBvc2VkTW9kdWxlcykgJiYgZXhwb3NlZE1vZHVsZXMubGVuZ3RoID4gMCkge1xuICAgICAgICAgICAgbGV0IHByZWxvYWQgPSBmcy5yZWFkRmlsZVN5bmModGhpcy4kLmVudi5wYXRocy5lbGVjdHJvbkFwcC5wcmVsb2FkLCAndXRmOCcpO1xuICAgICAgICAgICAgY29uc3QgbW9kdWxlcyA9IHRoaXMuJC5kZXNrdG9wLmdldFNldHRpbmdzKClcbiAgICAgICAgICAgICAgICAuZXhwb3NlZE1vZHVsZXNcbiAgICAgICAgICAgICAgICAucmVkdWNlKFxuICAgICAgICAgICAgICAgICAgICAvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgbm8tcmV0dXJuLWFzc2lnbixuby1wYXJhbS1yZWFzc2lnblxuICAgICAgICAgICAgICAgICAgICAocHJldiwgbW9kdWxlKSA9PiAocHJldiArPSBgJyR7bW9kdWxlfScsIGAsIHByZXYpLCAnJ1xuICAgICAgICAgICAgICAgICk7XG5cbiAgICAgICAgICAgIHByZWxvYWQgPSBwcmVsb2FkLnJlcGxhY2UoJ2NvbnN0IGV4cG9zZWRNb2R1bGVzID0gWycsIGBjb25zdCBleHBvc2VkTW9kdWxlcyA9IFske21vZHVsZXN9YCk7XG4gICAgICAgICAgICBmcy53cml0ZUZpbGVTeW5jKHRoaXMuJC5lbnYucGF0aHMuZWxlY3Ryb25BcHAucHJlbG9hZCwgcHJlbG9hZCk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBFbnN1cmVzIGFsbCByZXF1aXJlZCBkZXBlbmRlbmNpZXMgYXJlIGFkZGVkIHRvIHRoZSBNZXRlb3IgcHJvamVjdC5cbiAgICAgKiBAcmV0dXJucyB7UHJvbWlzZS48dm9pZD59XG4gICAgICovXG4gICAgYXN5bmMgZW5zdXJlTWV0ZW9yRGVwZW5kZW5jaWVzKCkge1xuICAgICAgICBsZXQgcGFja2FnZXMgPSBbXTtcbiAgICAgICAgY29uc3QgcGFja2FnZXNXaXRoVmVyc2lvbiA9IFtdO1xuICAgICAgICBsZXQgcGx1Z2lucyA9ICdwbHVnaW5zIFsnO1xuXG4gICAgICAgIE9iamVjdC5rZXlzKHRoaXMuJC5kZXNrdG9wLmdldERlcGVuZGVuY2llcygpLnBsdWdpbnMpLmZvckVhY2goKHBsdWdpbikgPT4ge1xuICAgICAgICAgICAgLy8gUmVhZCBwYWNrYWdlLmpzb24gb2YgdGhlIHBsdWdpbi5cbiAgICAgICAgICAgIGNvbnN0IHBhY2thZ2VKc29uID1cbiAgICAgICAgICAgICAgICBKU09OLnBhcnNlKFxuICAgICAgICAgICAgICAgICAgICBmcy5yZWFkRmlsZVN5bmMoXG4gICAgICAgICAgICAgICAgICAgICAgICBwYXRoLmpvaW4oXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy4kLmVudi5wYXRocy5lbGVjdHJvbkFwcC5ub2RlTW9kdWxlcywgcGx1Z2luLCAncGFja2FnZS5qc29uJ1xuICAgICAgICAgICAgICAgICAgICAgICAgKSxcbiAgICAgICAgICAgICAgICAgICAgICAgICd1dGY4J1xuICAgICAgICAgICAgICAgICAgICApXG4gICAgICAgICAgICAgICAgKTtcblxuICAgICAgICAgICAgaWYgKCdtZXRlb3JEZXBlbmRlbmNpZXMnIGluIHBhY2thZ2VKc29uICYmIHR5cGVvZiBwYWNrYWdlSnNvbi5tZXRlb3JEZXBlbmRlbmNpZXMgPT09ICdvYmplY3QnKSB7XG4gICAgICAgICAgICAgICAgcGx1Z2lucyArPSBgJHtwbHVnaW59LCBgO1xuICAgICAgICAgICAgICAgIHBhY2thZ2VzLnVuc2hpZnQoLi4uT2JqZWN0LmtleXMocGFja2FnZUpzb24ubWV0ZW9yRGVwZW5kZW5jaWVzKSk7XG4gICAgICAgICAgICAgICAgcGFja2FnZXNXaXRoVmVyc2lvbi51bnNoaWZ0KC4uLnBhY2thZ2VzLm1hcCgocGFja2FnZU5hbWUpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKHBhY2thZ2VKc29uLm1ldGVvckRlcGVuZGVuY2llc1twYWNrYWdlTmFtZV0gPT09ICdAdmVyc2lvbicpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiBgJHtwYWNrYWdlTmFtZX1AJHtwYWNrYWdlSnNvbi52ZXJzaW9ufWA7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGAke3BhY2thZ2VOYW1lfUAke3BhY2thZ2VKc29uLm1ldGVvckRlcGVuZGVuY2llc1twYWNrYWdlTmFtZV19YDtcbiAgICAgICAgICAgICAgICB9KSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGNvbnN0IHBhY2thZ2VzQ291bnQgPSBwYWNrYWdlcy5sZW5ndGg7XG4gICAgICAgIHBhY2thZ2VzID0gcGFja2FnZXMuZmlsdGVyKHZhbHVlID0+ICF0aGlzLmRlcHJlY3RhdGVkUGx1Z2lucy5pbmNsdWRlcyh2YWx1ZSkpO1xuICAgICAgICBpZiAocGFja2FnZXNDb3VudCAhPT0gcGFja2FnZXMubGVuZ3RoKSB7XG4gICAgICAgICAgICB0aGlzLmxvZy53YXJuKCd5b3UgaGF2ZSBzb21lIGRlcHJlY2F0ZWQgbWV0ZW9yIGRlc2t0b3AgcGx1Z2lucyBpbiB5b3VyIHNldHRpbmdzLCBwbGVhc2UgcmVtb3ZlICcgK1xuICAgICAgICAgICAgICAgIGB0aGVtIChkZXByZWNhdGVkIHBsdWdpbnM6ICR7dGhpcy5kZXByZWN0YXRlZFBsdWdpbnMuam9pbignLCAnKX0pYCk7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAocGFja2FnZXMubGVuZ3RoID4gMCkge1xuICAgICAgICAgICAgcGx1Z2lucyA9IGAke3BsdWdpbnMuc3Vic3RyKDAsIHBsdWdpbnMubGVuZ3RoIC0gMil9XWA7XG4gICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgIGF3YWl0IHRoaXMuJC5tZXRlb3JBcHAubWV0ZW9yTWFuYWdlci5lbnN1cmVQYWNrYWdlcyhcbiAgICAgICAgICAgICAgICAgICAgcGFja2FnZXMsIHBhY2thZ2VzV2l0aFZlcnNpb24sIHBsdWdpbnNcbiAgICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihlKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cblxuICAgIC8qKlxuICAgICAqIEJ1aWxkcyBtZXRlb3IgYXBwLlxuICAgICAqL1xuICAgIGFzeW5jIGdldE1ldGVvckNsaWVudEJ1aWxkKCkge1xuICAgICAgICBhd2FpdCB0aGlzLiQubWV0ZW9yQXBwLmJ1aWxkKCk7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogUmVtb3ZlcyBub2RlX21vZHVsZXMgaWYgbmVlZGVkLlxuICAgICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICAgICAqL1xuICAgIGFzeW5jIGhhbmRsZVN0YXRlT2ZOb2RlTW9kdWxlcygpIHtcbiAgICAgICAgaWYgKHRoaXMuJC5lbnYuaXNQcm9kdWN0aW9uQnVpbGQoKSB8fCB0aGlzLiQuZW52Lm9wdGlvbnMuaWEzMikge1xuICAgICAgICAgICAgaWYgKCF0aGlzLiQuZW52LmlzUHJvZHVjdGlvbkJ1aWxkKCkpIHtcbiAgICAgICAgICAgICAgICB0aGlzLmxvZy5pbmZvKCdjbGVhcmluZyBub2RlX21vZHVsZXMgYmVjYXVzZSB3ZSBuZWVkIHRvIGhhdmUgaXQgY2xlYXIgZm9yIGlhMzIgcmVidWlsZCcpO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICB0aGlzLmxvZy5pbmZvKCdjbGVhcmluZyBub2RlX21vZHVsZXMgYmVjYXVzZSB0aGlzIGlzIGEgcHJvZHVjdGlvbiBidWlsZCcpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICBhd2FpdCB0aGlzLiQudXRpbHMucm1XaXRoUmV0cmllcyhcbiAgICAgICAgICAgICAgICAgICAgJy1yZicsIHRoaXMuJC5lbnYucGF0aHMuZWxlY3Ryb25BcHAubm9kZU1vZHVsZXNcbiAgICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihlKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBJZiB0aGVyZSBpcyBhIHRlbXBvcmFyeSBub2RlX21vZHVsZXMgZm9sZGVyIGFuZCBubyBub2RlX21vZHVsZXMgZm9sZGVyLCB3ZSB3aWxsXG4gICAgICogcmVzdG9yZSBpdCwgYXMgaXQgbWlnaHQgYmUgYSBsZWZ0b3ZlciBmcm9tIGFuIGludGVycnVwdGVkIGZsb3cuXG4gICAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gICAgICovXG4gICAgYXN5bmMgaGFuZGxlVGVtcG9yYXJ5Tm9kZU1vZHVsZXMoKSB7XG4gICAgICAgIGlmICh0aGlzLiQudXRpbHMuZXhpc3RzKHRoaXMuJC5lbnYucGF0aHMuZWxlY3Ryb25BcHAudG1wTm9kZU1vZHVsZXMpKSB7XG4gICAgICAgICAgICBpZiAoIXRoaXMuJC51dGlscy5leGlzdHModGhpcy4kLmVudi5wYXRocy5lbGVjdHJvbkFwcC5ub2RlTW9kdWxlcykpIHtcbiAgICAgICAgICAgICAgICB0aGlzLmxvZy5kZWJ1ZygnbW92aW5nIHRlbXAgbm9kZV9tb2R1bGVzIGJhY2snKTtcbiAgICAgICAgICAgICAgICBzaGVsbC5tdihcbiAgICAgICAgICAgICAgICAgICAgdGhpcy4kLmVudi5wYXRocy5lbGVjdHJvbkFwcC50bXBOb2RlTW9kdWxlcyxcbiAgICAgICAgICAgICAgICAgICAgdGhpcy4kLmVudi5wYXRocy5lbGVjdHJvbkFwcC5ub2RlTW9kdWxlc1xuICAgICAgICAgICAgICAgICk7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIC8vIElmIHRoZXJlIGlzIGEgbm9kZV9tb2R1bGVzIGZvbGRlciwgd2Ugc2hvdWxkIGNsZWFyIHRoZSB0ZW1wb3Jhcnkgb25lLlxuICAgICAgICAgICAgICAgIHRoaXMubG9nLmRlYnVnKCdjbGVhcmluZyB0ZW1wIG5vZGVfbW9kdWxlcyBiZWNhdXNlIG5ldyBvbmUgaXMgYWxyZWFkeSBjcmVhdGVkJyk7XG4gICAgICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICAgICAgYXdhaXQgdGhpcy4kLnV0aWxzLnJtV2l0aFJldHJpZXMoXG4gICAgICAgICAgICAgICAgICAgICAgICAnLXJmJywgdGhpcy4kLmVudi5wYXRocy5lbGVjdHJvbkFwcC50bXBOb2RlTW9kdWxlc1xuICAgICAgICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGUpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cblxuICAgIC8qKlxuICAgICAqIFJ1bnMgbnBtIGxpbmsgZm9yIGV2ZXJ5IHBhY2thZ2Ugc3BlY2lmaWVkIGluIHNldHRpbmdzLmpzb24tPmxpbmtQYWNrYWdlcy5cbiAgICAgKi9cbiAgICBhc3luYyBsaW5rTnBtUGFja2FnZXMoKSB7XG4gICAgICAgIGlmICh0aGlzLiQuZW52LmlzUHJvZHVjdGlvbkJ1aWxkKCkpIHtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBjb25zdCBzZXR0aW5ncyA9IHRoaXMuJC5kZXNrdG9wLmdldFNldHRpbmdzKCk7XG4gICAgICAgIGNvbnN0IHByb21pc2VzID0gW107XG4gICAgICAgIGlmICgnbGlua1BhY2thZ2VzJyBpbiB0aGlzLiQuZGVza3RvcC5nZXRTZXR0aW5ncygpKSB7XG4gICAgICAgICAgICBpZiAoQXJyYXkuaXNBcnJheShzZXR0aW5ncy5saW5rUGFja2FnZXMpKSB7XG4gICAgICAgICAgICAgICAgc2V0dGluZ3MubGlua1BhY2thZ2VzLmZvckVhY2gocGFja2FnZU5hbWUgPT5cbiAgICAgICAgICAgICAgICAgICAgcHJvbWlzZXMucHVzaChcbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuJC5tZXRlb3JBcHAucnVuTnBtKFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIFsnbGluaycsIHBhY2thZ2VOYW1lXSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB1bmRlZmluZWQsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy4kLmVudi5wYXRocy5lbGVjdHJvbkFwcC5yb290XG4gICAgICAgICAgICAgICAgICAgICAgICApXG4gICAgICAgICAgICAgICAgICAgICkpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIGF3YWl0IFByb21pc2UuYWxsKHByb21pc2VzKTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBSdW5zIG5wbSBpbiB0aGUgZWxlY3Ryb24gYXBwIHRvIGdldCB0aGUgZGVwZW5kZW5jaWVzIGluc3RhbGxlZC5cbiAgICAgKiBAcmV0dXJucyB7UHJvbWlzZX1cbiAgICAgKi9cbiAgICBhc3luYyBlbnN1cmVEZXBzKCkge1xuICAgICAgICB0aGlzLmxvZy5pbmZvKCdpbnN0YWxsaW5nIGRlcGVuZGVuY2llcycpO1xuICAgICAgICBpZiAodGhpcy4kLnV0aWxzLmV4aXN0cyh0aGlzLiQuZW52LnBhdGhzLmVsZWN0cm9uQXBwLm5vZGVNb2R1bGVzKSkge1xuICAgICAgICAgICAgdGhpcy5sb2cuZGVidWcoJ3J1bm5pbmcgbnBtIHBydW5lIHRvIHdpcGUgdW5uZWVkZWQgZGVwZW5kZW5jaWVzJyk7XG4gICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgIGF3YWl0IHRoaXMucnVuTnBtKFsncHJ1bmUnXSk7XG4gICAgICAgICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGUpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLnJ1bk5wbShbJ2luc3RhbGwnXSwgdGhpcy4kLmVudi5zdGRpbyk7XG4gICAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihlKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIC8qKlxuICAgICAqIFdhcm5zIGlmIHBsdWdpbnMgdmVyc2lvbiBhcmUgb3V0ZGF0ZWQgaW4gY29tcGFyZSB0byB0aGUgbmV3ZXN0IHNjYWZmb2xkLlxuICAgICAqIEBwYXJhbSB7T2JqZWN0fSBwbHVnaW5zVmVyc2lvbnMgLSBjdXJyZW50IHBsdWdpbnMgdmVyc2lvbnMgZnJvbSBzZXR0aW5ncy5qc29uXG4gICAgICovXG4gICAgY2hlY2tQbHVnaW5zVmVyc2lvbihwbHVnaW5zVmVyc2lvbnMpIHtcbiAgICAgICAgY29uc3Qgc2V0dGluZ3NKc29uID0gSlNPTi5wYXJzZShcbiAgICAgICAgICAgIGZzLnJlYWRGaWxlU3luYyhwYXRoLmpvaW4odGhpcy4kLmVudi5wYXRocy5zY2FmZm9sZCwgJ3NldHRpbmdzLmpzb24nKSlcbiAgICAgICAgKTtcbiAgICAgICAgY29uc3Qgc2NhZmZvbGRQbHVnaW5zVmVyc2lvbiA9IHRoaXMuJC5kZXNrdG9wLmdldERlcGVuZGVuY2llcyhzZXR0aW5nc0pzb24sIGZhbHNlKS5wbHVnaW5zO1xuICAgICAgICBPYmplY3Qua2V5cyhwbHVnaW5zVmVyc2lvbnMpLmZvckVhY2goKHBsdWdpbk5hbWUpID0+IHtcbiAgICAgICAgICAgIGlmIChwbHVnaW5OYW1lIGluIHNjYWZmb2xkUGx1Z2luc1ZlcnNpb24gJiZcbiAgICAgICAgICAgICAgICBzY2FmZm9sZFBsdWdpbnNWZXJzaW9uW3BsdWdpbk5hbWVdICE9PSBwbHVnaW5zVmVyc2lvbnNbcGx1Z2luTmFtZV0gJiZcbiAgICAgICAgICAgICAgICBzZW12ZXIubHQocGx1Z2luc1ZlcnNpb25zW3BsdWdpbk5hbWVdLCBzY2FmZm9sZFBsdWdpbnNWZXJzaW9uW3BsdWdpbk5hbWVdKVxuICAgICAgICAgICAgKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5sb2cud2FybihgeW91IGFyZSB1c2luZyBvdXRkYXRlZCB2ZXJzaW9uICR7cGx1Z2luc1ZlcnNpb25zW3BsdWdpbk5hbWVdfSBvZiBgICtcbiAgICAgICAgICAgICAgICAgICAgYCR7cGx1Z2luTmFtZX0sIHRoZSBzdWdnZXN0ZWQgdmVyc2lvbiB0byB1c2UgaXMgYCArXG4gICAgICAgICAgICAgICAgICAgIGAke3NjYWZmb2xkUGx1Z2luc1ZlcnNpb25bcGx1Z2luTmFtZV19YCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIE1lcmdlcyBjb3JlIGRlcGVuZGVuY3kgbGlzdCB3aXRoIHRoZSBkZXBlbmRlbmNpZXMgZnJvbSAuZGVza3RvcC5cbiAgICAgKi9cbiAgICB1cGRhdGVEZXBlbmRlbmNpZXNMaXN0KCkge1xuICAgICAgICB0aGlzLmxvZy5pbmZvKCd1cGRhdGluZyBsaXN0IG9mIHBhY2thZ2UuanNvblxcJ3MgZGVwZW5kZW5jaWVzJyk7XG4gICAgICAgIGNvbnN0IGRlc2t0b3BEZXBlbmRlbmNpZXMgPSB0aGlzLiQuZGVza3RvcC5nZXREZXBlbmRlbmNpZXMoKTtcblxuICAgICAgICB0aGlzLmNoZWNrUGx1Z2luc1ZlcnNpb24oZGVza3RvcERlcGVuZGVuY2llcy5wbHVnaW5zKTtcblxuICAgICAgICB0aGlzLmxvZy5kZWJ1ZygnbWVyZ2luZyBzZXR0aW5ncy5qc29uW2RlcGVuZGVuY2llc10nKTtcbiAgICAgICAgdGhpcy5kZXBzTWFuYWdlci5tZXJnZURlcGVuZGVuY2llcyhcbiAgICAgICAgICAgICdzZXR0aW5ncy5qc29uW2RlcGVuZGVuY2llc10nLFxuICAgICAgICAgICAgZGVza3RvcERlcGVuZGVuY2llcy5mcm9tU2V0dGluZ3NcbiAgICAgICAgKTtcbiAgICAgICAgdGhpcy5sb2cuZGVidWcoJ21lcmdpbmcgc2V0dGluZ3MuanNvbltwbHVnaW5zXScpO1xuICAgICAgICB0aGlzLmRlcHNNYW5hZ2VyLm1lcmdlRGVwZW5kZW5jaWVzKFxuICAgICAgICAgICAgJ3NldHRpbmdzLmpzb25bcGx1Z2luc10nLFxuICAgICAgICAgICAgZGVza3RvcERlcGVuZGVuY2llcy5wbHVnaW5zXG4gICAgICAgICk7XG5cbiAgICAgICAgdGhpcy5sb2cuZGVidWcoJ21lcmdpbmcgZGVwZW5kZW5jaWVzIGZyb20gbW9kdWxlcycpO1xuICAgICAgICBPYmplY3Qua2V5cyhkZXNrdG9wRGVwZW5kZW5jaWVzLm1vZHVsZXMpLmZvckVhY2gobW9kdWxlID0+XG4gICAgICAgICAgICB0aGlzLmRlcHNNYW5hZ2VyLm1lcmdlRGVwZW5kZW5jaWVzKFxuICAgICAgICAgICAgICAgIGBtb2R1bGVbJHttb2R1bGV9XWAsXG4gICAgICAgICAgICAgICAgZGVza3RvcERlcGVuZGVuY2llcy5tb2R1bGVzW21vZHVsZV1cbiAgICAgICAgICAgICkpO1xuXG4gICAgICAgIHRoaXMucGFja2FnZUpzb24uZGVwZW5kZW5jaWVzID0gdGhpcy5kZXBzTWFuYWdlci5nZXRSZW1vdGVEZXBlbmRlbmNpZXMoKTtcbiAgICAgICAgdGhpcy5wYWNrYWdlSnNvbi5sb2NhbERlcGVuZGVuY2llcyA9IHRoaXMuZGVwc01hbmFnZXIuZ2V0TG9jYWxEZXBlbmRlbmNpZXMoKTtcblxuICAgICAgICB0aGlzLmxvZy5kZWJ1Zygnd3JpdGluZyB1cGRhdGVkIHBhY2thZ2UuanNvbicpO1xuICAgICAgICBmcy53cml0ZUZpbGVTeW5jKFxuICAgICAgICAgICAgdGhpcy4kLmVudi5wYXRocy5lbGVjdHJvbkFwcC5wYWNrYWdlSnNvbiwgSlNPTi5zdHJpbmdpZnkodGhpcy5wYWNrYWdlSnNvbiwgbnVsbCwgMilcbiAgICAgICAgKTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBJbnN0YWxsIG5vZGUgbW9kdWxlcyBmcm9tIGxvY2FsIHBhdGhzIHVzaW5nIGxvY2FsLWluc3RhbGwuXG4gICAgICpcbiAgICAgKiBAcGFyYW0ge3N0cmluZ30gYXJjaFxuICAgICAqIEByZXR1cm5zIHtQcm9taXNlfVxuICAgICAqL1xuICAgIGluc3RhbGxMb2NhbE5vZGVNb2R1bGVzKGFyY2ggPSB0aGlzLiQuZW52Lm9wdGlvbnMuaWEzMiB8fCBwcm9jZXNzLmFyY2ggPT09ICdpYTMyJyA/ICdpYTMyJyA6ICd4NjQnKSB7XG4gICAgICAgIGNvbnN0IGxvY2FsRGVwZW5kZW5jaWVzID0gXy52YWx1ZXModGhpcy5wYWNrYWdlSnNvbi5sb2NhbERlcGVuZGVuY2llcyk7XG4gICAgICAgIGlmIChsb2NhbERlcGVuZGVuY2llcy5sZW5ndGggPT09IDApIHtcbiAgICAgICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKTtcbiAgICAgICAgfVxuICAgICAgICB0aGlzLmxvZy5pbmZvKCdpbnN0YWxsaW5nIGxvY2FsIG5vZGUgbW9kdWxlcycpO1xuICAgICAgICBjb25zdCBsYXN0UmVidWlsZCA9IHRoaXMuJC5lbGVjdHJvbkJ1aWxkZXIucHJlcGFyZUxhc3RSZWJ1aWxkT2JqZWN0KGFyY2gpO1xuICAgICAgICBjb25zdCBlbnYgPSB0aGlzLiQuZWxlY3Ryb25CdWlsZGVyLmdldEd5cEVudihsYXN0UmVidWlsZC5mcmFtZXdvcmtJbmZvLCBsYXN0UmVidWlsZC5wbGF0Zm9ybSwgbGFzdFJlYnVpbGQuYXJjaCk7XG4gICAgICAgIGNvbnN0IGluc3RhbGxlciA9IG5ldyBMb2NhbEluc3RhbGxlcihcbiAgICAgICAgICAgIHsgW3RoaXMuJC5lbnYucGF0aHMuZWxlY3Ryb25BcHAucm9vdF06IGxvY2FsRGVwZW5kZW5jaWVzIH0sXG4gICAgICAgICAgICB7IG5wbUVudjogZW52IH1cbiAgICAgICAgKTtcbiAgICAgICAgcHJvZ3Jlc3MoaW5zdGFsbGVyKTtcbiAgICAgICAgcmV0dXJuIGluc3RhbGxlci5pbnN0YWxsKCk7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogUmVidWlsZCBiaW5hcnkgZGVwZW5kZW5jaWVzIGFnYWluc3QgRWxlY3Ryb24ncyBub2RlIGhlYWRlcnMuXG4gICAgICogQHJldHVybnMge1Byb21pc2V9XG4gICAgICovXG4gICAgcmVidWlsZERlcHMoaW5zdGFsbCA9IGZhbHNlKSB7XG4gICAgICAgIGlmIChpbnN0YWxsKSB7XG4gICAgICAgICAgICB0aGlzLmxvZy5pbmZvKCdpc3N1aW5nIG5vZGVfbW9kdWxlcyBpbnN0YWxsIGZyb20gZWxlY3Ryb24tYnVpbGRlcicpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgdGhpcy5sb2cuaW5mbygnaXNzdWluZyBuYXRpdmUgbW9kdWxlcyByZWJ1aWxkIGZyb20gZWxlY3Ryb24tYnVpbGRlcicpO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgYXJjaCA9IHRoaXMuJC5lbnYub3B0aW9ucy5pYTMyIHx8IHByb2Nlc3MuYXJjaCA9PT0gJ2lhMzInID8gJ2lhMzInIDogJ3g2NCc7XG5cbiAgICAgICAgaWYgKHRoaXMuJC5lbnYub3B0aW9ucy5pYTMyKSB7XG4gICAgICAgICAgICB0aGlzLmxvZy52ZXJib3NlKCdmb3JjaW5nIHJlYnVpbGQgZm9yIDMyYml0Jyk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICB0aGlzLmxvZy52ZXJib3NlKGByZWJ1aWxkaW5nIGZvciAke2FyY2h9YCk7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gdGhpcy4kLmVsZWN0cm9uQnVpbGRlci5pbnN0YWxsT3JSZWJ1aWxkKGFyY2gsIHVuZGVmaW5lZCwgaW5zdGFsbCk7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogVXBkYXRlIHBhY2thZ2UuanNvbiBmaWVsZHMgYWNjb3JkaW5nbHkgdG8gd2hhdCBpcyBzZXQgaW4gc2V0dGluZ3MuanNvbi5cbiAgICAgKlxuICAgICAqIHBhY2thZ2VKc29uLm5hbWUgPSBzZXR0aW5ncy5wcm9qZWN0TmFtZVxuICAgICAqIHBhY2thZ2VKc29uLnZlcnNpb24gPSBzZXR0aW5ncy52ZXJzaW9uXG4gICAgICogcGFja2FnZUpzb24uKiA9IHNldHRpbmdzLnBhY2thZ2VKc29uRmllbGRzXG4gICAgICovXG4gICAgdXBkYXRlUGFja2FnZUpzb25GaWVsZHMoKSB7XG4gICAgICAgIHRoaXMubG9nLnZlcmJvc2UoJ3VwZGF0aW5nIHBhY2thZ2UuanNvbiBmaWVsZHMnKTtcbiAgICAgICAgY29uc3Qgc2V0dGluZ3MgPSB0aGlzLiQuZGVza3RvcC5nZXRTZXR0aW5ncygpO1xuICAgICAgICAvKiogQHR5cGUge2Rlc2t0b3BTZXR0aW5nc30gKi9cbiAgICAgICAgY29uc3QgcGFja2FnZUpzb24gPSB0aGlzLnNjYWZmb2xkLmdldERlZmF1bHRQYWNrYWdlSnNvbigpO1xuXG4gICAgICAgIHBhY2thZ2VKc29uLnZlcnNpb24gPSBzZXR0aW5ncy52ZXJzaW9uO1xuICAgICAgICBpZiAoJ3BhY2thZ2VKc29uRmllbGRzJyBpbiBzZXR0aW5ncykge1xuICAgICAgICAgICAgYXNzaWduSW4ocGFja2FnZUpzb24sIHNldHRpbmdzLnBhY2thZ2VKc29uRmllbGRzKTtcbiAgICAgICAgfVxuICAgICAgICBhc3NpZ25JbihwYWNrYWdlSnNvbiwgeyBuYW1lOiBzZXR0aW5ncy5wcm9qZWN0TmFtZSB9KTtcblxuICAgICAgICB0aGlzLmxvZy5kZWJ1Zygnd3JpdGluZyB1cGRhdGVkIHBhY2thZ2UuanNvbicpO1xuICAgICAgICBmcy53cml0ZUZpbGVTeW5jKFxuICAgICAgICAgICAgdGhpcy4kLmVudi5wYXRocy5lbGVjdHJvbkFwcC5wYWNrYWdlSnNvbiwgSlNPTi5zdHJpbmdpZnkocGFja2FnZUpzb24sIG51bGwsIDQpXG4gICAgICAgICk7XG4gICAgICAgIHRoaXMucGFja2FnZUpzb24gPSBwYWNrYWdlSnNvbjtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBVcGRhdGVzIHNldHRpbmdzLmpzb24gd2l0aCBlbnYgKHByb2QvZGV2KSBpbmZvcm1hdGlvbiBhbmQgdmVyc2lvbnMuXG4gICAgICovXG4gICAgYXN5bmMgdXBkYXRlU2V0dGluZ3NKc29uRmllbGRzKCkge1xuICAgICAgICB0aGlzLmxvZy5kZWJ1ZygndXBkYXRpbmcgc2V0dGluZ3MuanNvbiBmaWVsZHMnKTtcbiAgICAgICAgY29uc3Qgc2V0dGluZ3MgPSB0aGlzLiQuZGVza3RvcC5nZXRTZXR0aW5ncygpO1xuXG4gICAgICAgIC8vIFNhdmUgdmVyc2lvbnMuXG4gICAgICAgIHNldHRpbmdzLmNvbXBhdGliaWxpdHlWZXJzaW9uID0gdGhpcy5jb21wYXRpYmlsaXR5VmVyc2lvbjtcblxuICAgICAgICAvLyBQYXNzIGluZm9ybWF0aW9uIGFib3V0IGJ1aWxkIHR5cGUgdG8gdGhlIHNldHRpbmdzLmpzb24uXG4gICAgICAgIHNldHRpbmdzLmVudiA9ICh0aGlzLiQuZW52LmlzUHJvZHVjdGlvbkJ1aWxkKCkpID9cbiAgICAgICAgICAgICdwcm9kJyA6ICdkZXYnO1xuXG4gICAgICAgIGNvbnN0IHZlcnNpb24gPSBhd2FpdCB0aGlzLiQuZGVza3RvcC5nZXRIYXNoVmVyc2lvbigpO1xuICAgICAgICBzZXR0aW5ncy5kZXNrdG9wVmVyc2lvbiA9IGAke3ZlcnNpb259XyR7c2V0dGluZ3MuZW52fWA7XG5cbiAgICAgICAgc2V0dGluZ3MubWV0ZW9yRGVza3RvcFZlcnNpb24gPSB0aGlzLiQuZ2V0VmVyc2lvbigpO1xuXG4gICAgICAgIGlmICh0aGlzLiQuZW52Lm9wdGlvbnMucHJvZERlYnVnKSB7XG4gICAgICAgICAgICBzZXR0aW5ncy5wcm9kRGVidWcgPSB0cnVlO1xuICAgICAgICB9XG5cbiAgICAgICAgZnMud3JpdGVGaWxlU3luYyhcbiAgICAgICAgICAgIHRoaXMuJC5lbnYucGF0aHMuZGVza3RvcFRtcC5zZXR0aW5ncywgSlNPTi5zdHJpbmdpZnkoc2V0dGluZ3MsIG51bGwsIDQpXG4gICAgICAgICk7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogQ29waWVzIGZpbGVzIGZyb20gcHJlcGFyZWQgLmRlc2t0b3AgdG8gZGVza3RvcC5hc2FyIGluIGVsZWN0cm9uIGFwcC5cbiAgICAgKi9cbiAgICBwYWNrRGVza3RvcFRvQXNhcigpIHtcbiAgICAgICAgdGhpcy5sb2cuaW5mbygncGFja2luZyAuZGVza3RvcCB0byBhc2FyJyk7XG4gICAgICAgIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICAgICAgICBhc2FyLmNyZWF0ZVBhY2thZ2UoXG4gICAgICAgICAgICAgICAgdGhpcy4kLmVudi5wYXRocy5kZXNrdG9wVG1wLnJvb3QsXG4gICAgICAgICAgICAgICAgdGhpcy4kLmVudi5wYXRocy5lbGVjdHJvbkFwcC5kZXNrdG9wQXNhclxuICAgICAgICAgICAgKVxuICAgICAgICAgICAgICAgIC50aGVuKCgpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5sb2cudmVyYm9zZSgnY2xlYXJpbmcgdGVtcG9yYXJ5IC5kZXNrdG9wJyk7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMuJC51dGlsc1xuICAgICAgICAgICAgICAgICAgICAgICAgLnJtV2l0aFJldHJpZXMoJy1yZicsIHRoaXMuJC5lbnYucGF0aHMuZGVza3RvcFRtcC5yb290KVxuICAgICAgICAgICAgICAgICAgICAgICAgLnRoZW4oKCkgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJlc29sdmUoKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIH0pXG4gICAgICAgICAgICAgICAgICAgICAgICAuY2F0Y2goKGUpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICByZWplY3QoZSk7XG4gICAgICAgICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICAgICAgcmVzb2x2ZSgpO1xuICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBNYWtlcyBhIHRlbXBvcmFyeSBjb3B5IG9mIC5kZXNrdG9wLlxuICAgICAqL1xuICAgIGNvcHlEZXNrdG9wVG9EZXNrdG9wVGVtcCgpIHtcbiAgICAgICAgdGhpcy5sb2cudmVyYm9zZSgnY29weWluZyAuZGVza3RvcCB0byB0ZW1wb3JhcnkgbG9jYXRpb24nKTtcbiAgICAgICAgc2hlbGwuY3AoJy1yZicsIHRoaXMuJC5lbnYucGF0aHMuZGVza3RvcC5yb290LCB0aGlzLiQuZW52LnBhdGhzLmRlc2t0b3BUbXAucm9vdCk7XG4gICAgICAgIC8vIFJlbW92ZSB0ZXN0IGZpbGVzLlxuICAgICAgICBkZWwuc3luYyhbXG4gICAgICAgICAgICBwYXRoLmpvaW4odGhpcy4kLmVudi5wYXRocy5kZXNrdG9wVG1wLnJvb3QsICcqKicsICcqLnRlc3QuanMnKVxuICAgICAgICBdLCB7IGZvcmNlOiB0cnVlIH0pO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIFJ1bnMgYmFiZWwgYW5kIHVnbGlmeSBvdmVyIC5kZXNrdG9wIGlmIHJlcXVlc3RlZC5cbiAgICAgKi9cbiAgICBhc3luYyB0cmFuc3BpbGVBbmRNaW5pZnkoKSB7XG4gICAgICAgIHRoaXMubG9nLmluZm8oJ3RyYW5zcGlsaW5nIGFuZCB1Z2xpZnlpbmcnKTtcblxuICAgICAgICBjb25zdCBzZXR0aW5ncyA9IHRoaXMuJC5kZXNrdG9wLmdldFNldHRpbmdzKCk7XG4gICAgICAgIGNvbnN0IG9wdGlvbnMgPSAndWdsaWZ5T3B0aW9ucycgaW4gc2V0dGluZ3MgPyBzZXR0aW5ncy51Z2xpZnlPcHRpb25zIDoge307XG5cbiAgICAgICAgY29uc3QgdWdsaWZ5aW5nRW5hYmxlZCA9ICd1Z2xpZnknIGluIHNldHRpbmdzICYmICEhc2V0dGluZ3MudWdsaWZ5O1xuXG4gICAgICAgIGNvbnN0IHByZXNldCA9IHByZXNldEVudih7XG4gICAgICAgICAgICB2ZXJzaW9uOiByZXF1aXJlKCcuLi9wYWNrYWdlLmpzb24nKS5kZXBlbmRlbmNpZXNbJ0BiYWJlbC9wcmVzZXQtZW52J10sXG4gICAgICAgICAgICBhc3NlcnRWZXJzaW9uOiAoKSA9PiB7IH1cbiAgICAgICAgfSwgeyB0YXJnZXRzOiB7IG5vZGU6ICcxNCcgfSB9KTtcblxuICAgICAgICBjb25zdCB7IGRhdGE6IGZpbGVzIH0gPSBhd2FpdCB0aGlzLiQudXRpbHMucmVhZERpcih0aGlzLiQuZW52LnBhdGhzLmRlc2t0b3BUbXAucm9vdCk7XG5cbiAgICAgICAgZmlsZXMuZm9yRWFjaCgoZmlsZSkgPT4ge1xuICAgICAgICAgICAgaWYgKGZpbGUuZW5kc1dpdGgoJy5qcycpKSB7XG4gICAgICAgICAgICAgICAgbGV0IHsgY29kZSB9ID0gdHJhbnNmb3JtRmlsZVN5bmMoZmlsZSwge1xuICAgICAgICAgICAgICAgICAgICBwcmVzZXRzOiBbcHJlc2V0XVxuICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgIGxldCBlcnJvcjtcbiAgICAgICAgICAgICAgICBpZiAoc2V0dGluZ3MuZW52ID09PSAncHJvZCcgJiYgdWdsaWZ5aW5nRW5hYmxlZCkge1xuICAgICAgICAgICAgICAgICAgICAoeyBjb2RlLCBlcnJvciB9ID0gdWdsaWZ5Lm1pbmlmeShjb2RlLCBvcHRpb25zKSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGlmIChlcnJvcikge1xuICAgICAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoZXJyb3IpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBmcy53cml0ZUZpbGVTeW5jKGZpbGUsIGNvZGUpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBNb3ZlcyBhbGwgdGhlIGZpbGVzIHRoYXQgc2hvdWxkIG5vdCBiZSBwYWNrZWQgaW50byBhc2FyIGludG8gYSBzYWZlIGxvY2F0aW9uIHdoaWNoIGlzIHRoZVxuICAgICAqICdleHRyYWN0ZWQnIGRpciBpbiB0aGUgZWxlY3Ryb24gYXBwLlxuICAgICAqL1xuICAgIGFzeW5jIGV4Y2x1ZGVGaWxlc0Zyb21BcmNoaXZlKCkge1xuICAgICAgICB0aGlzLmxvZy5pbmZvKCdleGNsdWRpbmcgZmlsZXMgZnJvbSBwYWNraW5nJyk7XG5cbiAgICAgICAgLy8gRW5zdXJlIGVtcHR5IGBleHRyYWN0ZWRgIGRpclxuXG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLiQudXRpbHMucm1XaXRoUmV0cmllcygnLXJmJywgdGhpcy4kLmVudi5wYXRocy5lbGVjdHJvbkFwcC5leHRyYWN0ZWQpO1xuICAgICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoZSk7XG4gICAgICAgIH1cblxuICAgICAgICBzaGVsbC5ta2Rpcih0aGlzLiQuZW52LnBhdGhzLmVsZWN0cm9uQXBwLmV4dHJhY3RlZCk7XG5cbiAgICAgICAgY29uc3QgY29uZmlncyA9IHRoaXMuJC5kZXNrdG9wLmdhdGhlck1vZHVsZUNvbmZpZ3MoKTtcblxuICAgICAgICAvLyBNb3ZlIGZpbGVzIHRoYXQgc2hvdWxkIG5vdCBiZSBhc2FyJ2VkLlxuICAgICAgICBjb25maWdzLmZvckVhY2goKGNvbmZpZykgPT4ge1xuICAgICAgICAgICAgY29uc3QgbW9kdWxlQ29uZmlnID0gY29uZmlnO1xuICAgICAgICAgICAgaWYgKCdleHRyYWN0JyBpbiBtb2R1bGVDb25maWcpIHtcbiAgICAgICAgICAgICAgICBpZiAoIUFycmF5LmlzQXJyYXkobW9kdWxlQ29uZmlnLmV4dHJhY3QpKSB7XG4gICAgICAgICAgICAgICAgICAgIG1vZHVsZUNvbmZpZy5leHRyYWN0ID0gW21vZHVsZUNvbmZpZy5leHRyYWN0XTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgbW9kdWxlQ29uZmlnLmV4dHJhY3QuZm9yRWFjaCgoZmlsZSkgPT4ge1xuICAgICAgICAgICAgICAgICAgICB0aGlzLmxvZy5kZWJ1ZyhgZXhjbHVkaW5nICR7ZmlsZX0gZnJvbSAke2NvbmZpZy5uYW1lfWApO1xuICAgICAgICAgICAgICAgICAgICBjb25zdCBmaWxlUGF0aCA9IHBhdGguam9pbihcbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuJC5lbnYucGF0aHMuZGVza3RvcFRtcC5tb2R1bGVzLCBtb2R1bGVDb25maWcuZGlyTmFtZSwgZmlsZVxuICAgICAgICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgICAgICAgICBjb25zdCBkZXN0aW5hdGlvblBhdGggPSBwYXRoLmpvaW4oXG4gICAgICAgICAgICAgICAgICAgICAgICB0aGlzLiQuZW52LnBhdGhzLmVsZWN0cm9uQXBwLmV4dHJhY3RlZCwgbW9kdWxlQ29uZmlnLmRpck5hbWVcbiAgICAgICAgICAgICAgICAgICAgKTtcblxuICAgICAgICAgICAgICAgICAgICBpZiAoIXRoaXMuJC51dGlscy5leGlzdHMoZGVzdGluYXRpb25QYXRoKSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgc2hlbGwubWtkaXIoZGVzdGluYXRpb25QYXRoKTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICBzaGVsbC5tdihmaWxlUGF0aCwgZGVzdGluYXRpb25QYXRo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