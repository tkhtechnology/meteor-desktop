"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
var _runtime = _interopRequireDefault(require("regenerator-runtime/runtime"));
var _lodash = require("lodash");
var _log = _interopRequireDefault(require("./log"));
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
// eslint-disable-next-line no-unused-vars

/**
 * Utility class designed for merging dependencies list with simple validation and duplicate
 * detection.
 *
 * @class
 */
class DependenciesManager {
  /**
   * @param {MeteorDesktop} $                   - context
   * @param {Object}        defaultDependencies - core dependencies list
   * @constructor
   */
  constructor($, defaultDependencies) {
    this.log = new _log.default('dependenciesManager');
    this.$ = $;
    this.dependencies = defaultDependencies;

    // Regexes for matching certain types of dependencies version.
    // https://docs.npmjs.com/files/package.json#dependencies
    this.regexes = {
      local: /^(\.\.\/|~\/|\.\/|\/)/,
      git: /^git(\+(ssh|http)s?)?/,
      github: /^\w+-?\w+(?!-)\//,
      http: /^https?.+tar\.gz/,
      file: /^file:/
    };

    // Check for commit hashes.
    const gitCheck = {
      type: 'regex',
      regex: /#[a-f0-9]{7,40}/,
      test: 'match',
      message: 'git or github link must have a commit hash'
    };

    // Check for displaying warnings when npm package from local path is used.
    const localCheck = {
      onceName: 'localCheck',
      type: 'warning',
      message: 'using dependencies from local paths is permitted' + ' but dangerous - read more in README.md'
    };
    this.checks = {
      local: localCheck,
      file: localCheck,
      git: gitCheck,
      github: gitCheck,
      version: {
        type: 'regex',
        // Matches all the semver ranges operators, empty strings and `*`.
        regex: /[\^|><= ~-]|\.x|^$|^\*$/,
        test: 'do not match',
        message: 'semver ranges are forbidden, please specify exact version'
      }
    };
  }

  /**
   * Just a public getter.
   * @returns {Object}
   */
  getDependencies() {
    return this.dependencies;
  }

  /**
   * Returns local dependencies.
   * @returns {Object}
   */
  getLocalDependencies() {
    return Object.keys(this.dependencies).filter(dependency => this.regexes.local.test(this.dependencies[dependency]) || this.regexes.file.test(this.dependencies[dependency])).reduce((localDependencies, currentDependency) => Object.assign(localDependencies, {
      [currentDependency]: this.dependencies[currentDependency]
    }), {});
  }

  /**
   * Returns remote dependencies.
   * @returns {Object}
   */
  getRemoteDependencies() {
    return Object.keys(this.dependencies).filter(dependency => !this.regexes.local.test(this.dependencies[dependency]) && !this.regexes.file.test(this.dependencies[dependency])).reduce((localDependencies, currentDependency) => Object.assign(localDependencies, {
      [currentDependency]: this.dependencies[currentDependency]
    }), {});
  }

  /**
   * Merges dependencies into one list.
   *
   * @param {string} from         - describes where the dependencies were set
   * @param {Object} dependencies - dependencies list
   */
  mergeDependencies(from, dependencies) {
    if (this.validateDependenciesVersions(from, dependencies)) {
      this.detectDuplicatedDependencies(from, dependencies);
      (0, _lodash.assignIn)(this.dependencies, dependencies);
    }
  }

  /**
   * Detects dependency version type.
   * @param {string} version - version string of the dependency
   * @return {string}
   */
  detectDependencyVersionType(version) {
    const type = Object.keys(this.regexes).find(dependencyType => this.regexes[dependencyType].test(version));
    return type || 'version';
  }

  /**
   * Validates semver and detect ranges.
   *
   * @param {string} from         - describes where the dependencies were set
   * @param {Object} dependencies - dependencies list
   */
  validateDependenciesVersions(from, dependencies) {
    const warningsShown = {};
    (0, _lodash.forEach)(dependencies, (version, name) => {
      const type = this.detectDependencyVersionType(version);
      if (this.checks[type]) {
        const check = this.checks[type];
        if (check.type === 'regex') {
          const checkResult = check.test === 'match' ? this.checks[type].regex.test(version) : !this.checks[type].regex.test(version);
          if (!checkResult) {
            throw new Error(`dependency ${name}:${version} from ${from} failed version ` + `check with message: ${this.checks[type].message}`);
          }
        }
        if (check.type === 'warning' && !warningsShown[check.onceName]) {
          warningsShown[check.onceName] = true;
          this.log.warn(`dependency ${name}:${version} from ${from} caused a` + ` warning: ${check.message}`);
        }
      }
    });
    return true;
  }

  /**
   * Detects duplicates.
   *
   * @param {string} from         - describes where the dependencies were set
   * @param {Object} dependencies - dependencies list
   */
  detectDuplicatedDependencies(from, dependencies) {
    const duplicates = (0, _lodash.intersection)(Object.keys(dependencies), Object.keys(this.dependencies));
    if (duplicates.length > 0) {
      duplicates.forEach(name => {
        if (dependencies[name] !== this.dependencies[name]) {
          throw new Error(`While processing dependencies from ${from}, a dependency ` + `${name}: ${dependencies[name]} was found to be conflicting with a ` + `dependency (${this.dependencies[name]}) that was already declared in ` + 'other module or it is used in core of the electron app.');
        }
      });
    }
  }
}
exports.default = DependenciesManager;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJfcnVudGltZSIsIl9pbnRlcm9wUmVxdWlyZURlZmF1bHQiLCJyZXF1aXJlIiwiX2xvZGFzaCIsIl9sb2ciLCJlIiwiX19lc01vZHVsZSIsImRlZmF1bHQiLCJEZXBlbmRlbmNpZXNNYW5hZ2VyIiwiY29uc3RydWN0b3IiLCIkIiwiZGVmYXVsdERlcGVuZGVuY2llcyIsImxvZyIsIkxvZyIsImRlcGVuZGVuY2llcyIsInJlZ2V4ZXMiLCJsb2NhbCIsImdpdCIsImdpdGh1YiIsImh0dHAiLCJmaWxlIiwiZ2l0Q2hlY2siLCJ0eXBlIiwicmVnZXgiLCJ0ZXN0IiwibWVzc2FnZSIsImxvY2FsQ2hlY2siLCJvbmNlTmFtZSIsImNoZWNrcyIsInZlcnNpb24iLCJnZXREZXBlbmRlbmNpZXMiLCJnZXRMb2NhbERlcGVuZGVuY2llcyIsIk9iamVjdCIsImtleXMiLCJmaWx0ZXIiLCJkZXBlbmRlbmN5IiwicmVkdWNlIiwibG9jYWxEZXBlbmRlbmNpZXMiLCJjdXJyZW50RGVwZW5kZW5jeSIsImFzc2lnbiIsImdldFJlbW90ZURlcGVuZGVuY2llcyIsIm1lcmdlRGVwZW5kZW5jaWVzIiwiZnJvbSIsInZhbGlkYXRlRGVwZW5kZW5jaWVzVmVyc2lvbnMiLCJkZXRlY3REdXBsaWNhdGVkRGVwZW5kZW5jaWVzIiwiYXNzaWduSW4iLCJkZXRlY3REZXBlbmRlbmN5VmVyc2lvblR5cGUiLCJmaW5kIiwiZGVwZW5kZW5jeVR5cGUiLCJ3YXJuaW5nc1Nob3duIiwiZm9yRWFjaCIsIm5hbWUiLCJjaGVjayIsImNoZWNrUmVzdWx0IiwiRXJyb3IiLCJ3YXJuIiwiZHVwbGljYXRlcyIsImludGVyc2VjdGlvbiIsImxlbmd0aCIsImV4cG9ydHMiXSwic291cmNlcyI6WyIuLi9saWIvZGVwZW5kZW5jaWVzTWFuYWdlci5qcyJdLCJzb3VyY2VzQ29udGVudCI6WyIvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgbm8tdW51c2VkLXZhcnNcbmltcG9ydCByZWdlbmVyYXRvclJ1bnRpbWUgZnJvbSAncmVnZW5lcmF0b3ItcnVudGltZS9ydW50aW1lJztcbmltcG9ydCB7IGZvckVhY2gsIGFzc2lnbkluLCBpbnRlcnNlY3Rpb24gfSBmcm9tICdsb2Rhc2gnO1xuXG5pbXBvcnQgTG9nIGZyb20gJy4vbG9nJztcblxuLyoqXG4gKiBVdGlsaXR5IGNsYXNzIGRlc2lnbmVkIGZvciBtZXJnaW5nIGRlcGVuZGVuY2llcyBsaXN0IHdpdGggc2ltcGxlIHZhbGlkYXRpb24gYW5kIGR1cGxpY2F0ZVxuICogZGV0ZWN0aW9uLlxuICpcbiAqIEBjbGFzc1xuICovXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBEZXBlbmRlbmNpZXNNYW5hZ2VyIHtcbiAgICAvKipcbiAgICAgKiBAcGFyYW0ge01ldGVvckRlc2t0b3B9ICQgICAgICAgICAgICAgICAgICAgLSBjb250ZXh0XG4gICAgICogQHBhcmFtIHtPYmplY3R9ICAgICAgICBkZWZhdWx0RGVwZW5kZW5jaWVzIC0gY29yZSBkZXBlbmRlbmNpZXMgbGlzdFxuICAgICAqIEBjb25zdHJ1Y3RvclxuICAgICAqL1xuICAgIGNvbnN0cnVjdG9yKCQsIGRlZmF1bHREZXBlbmRlbmNpZXMpIHtcbiAgICAgICAgdGhpcy5sb2cgPSBuZXcgTG9nKCdkZXBlbmRlbmNpZXNNYW5hZ2VyJyk7XG4gICAgICAgIHRoaXMuJCA9ICQ7XG4gICAgICAgIHRoaXMuZGVwZW5kZW5jaWVzID0gZGVmYXVsdERlcGVuZGVuY2llcztcblxuICAgICAgICAvLyBSZWdleGVzIGZvciBtYXRjaGluZyBjZXJ0YWluIHR5cGVzIG9mIGRlcGVuZGVuY2llcyB2ZXJzaW9uLlxuICAgICAgICAvLyBodHRwczovL2RvY3MubnBtanMuY29tL2ZpbGVzL3BhY2thZ2UuanNvbiNkZXBlbmRlbmNpZXNcbiAgICAgICAgdGhpcy5yZWdleGVzID0ge1xuICAgICAgICAgICAgbG9jYWw6IC9eKFxcLlxcLlxcL3x+XFwvfFxcLlxcL3xcXC8pLyxcbiAgICAgICAgICAgIGdpdDogL15naXQoXFwrKHNzaHxodHRwKXM/KT8vLFxuICAgICAgICAgICAgZ2l0aHViOiAvXlxcdystP1xcdysoPyEtKVxcLy8sXG4gICAgICAgICAgICBodHRwOiAvXmh0dHBzPy4rdGFyXFwuZ3ovLFxuICAgICAgICAgICAgZmlsZTogL15maWxlOi9cbiAgICAgICAgfTtcblxuICAgICAgICAvLyBDaGVjayBmb3IgY29tbWl0IGhhc2hlcy5cbiAgICAgICAgY29uc3QgZ2l0Q2hlY2sgPSB7XG4gICAgICAgICAgICB0eXBlOiAncmVnZXgnLFxuICAgICAgICAgICAgcmVnZXg6IC8jW2EtZjAtOV17Nyw0MH0vLFxuICAgICAgICAgICAgdGVzdDogJ21hdGNoJyxcbiAgICAgICAgICAgIG1lc3NhZ2U6ICdnaXQgb3IgZ2l0aHViIGxpbmsgbXVzdCBoYXZlIGEgY29tbWl0IGhhc2gnXG4gICAgICAgIH07XG5cbiAgICAgICAgLy8gQ2hlY2sgZm9yIGRpc3BsYXlpbmcgd2FybmluZ3Mgd2hlbiBucG0gcGFja2FnZSBmcm9tIGxvY2FsIHBhdGggaXMgdXNlZC5cbiAgICAgICAgY29uc3QgbG9jYWxDaGVjayA9IHtcbiAgICAgICAgICAgIG9uY2VOYW1lOiAnbG9jYWxDaGVjaycsXG4gICAgICAgICAgICB0eXBlOiAnd2FybmluZycsXG4gICAgICAgICAgICBtZXNzYWdlOiAndXNpbmcgZGVwZW5kZW5jaWVzIGZyb20gbG9jYWwgcGF0aHMgaXMgcGVybWl0dGVkJyArXG4gICAgICAgICAgICAnIGJ1dCBkYW5nZXJvdXMgLSByZWFkIG1vcmUgaW4gUkVBRE1FLm1kJ1xuICAgICAgICB9O1xuXG4gICAgICAgIHRoaXMuY2hlY2tzID0ge1xuICAgICAgICAgICAgbG9jYWw6IGxvY2FsQ2hlY2ssXG4gICAgICAgICAgICBmaWxlOiBsb2NhbENoZWNrLFxuICAgICAgICAgICAgZ2l0OiBnaXRDaGVjayxcbiAgICAgICAgICAgIGdpdGh1YjogZ2l0Q2hlY2ssXG4gICAgICAgICAgICB2ZXJzaW9uOiB7XG4gICAgICAgICAgICAgICAgdHlwZTogJ3JlZ2V4JyxcbiAgICAgICAgICAgICAgICAvLyBNYXRjaGVzIGFsbCB0aGUgc2VtdmVyIHJhbmdlcyBvcGVyYXRvcnMsIGVtcHR5IHN0cmluZ3MgYW5kIGAqYC5cbiAgICAgICAgICAgICAgICByZWdleDogL1tcXF58Pjw9IH4tXXxcXC54fF4kfF5cXCokLyxcbiAgICAgICAgICAgICAgICB0ZXN0OiAnZG8gbm90IG1hdGNoJyxcbiAgICAgICAgICAgICAgICBtZXNzYWdlOiAnc2VtdmVyIHJhbmdlcyBhcmUgZm9yYmlkZGVuLCBwbGVhc2Ugc3BlY2lmeSBleGFjdCB2ZXJzaW9uJ1xuICAgICAgICAgICAgfVxuICAgICAgICB9O1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIEp1c3QgYSBwdWJsaWMgZ2V0dGVyLlxuICAgICAqIEByZXR1cm5zIHtPYmplY3R9XG4gICAgICovXG4gICAgZ2V0RGVwZW5kZW5jaWVzKCkge1xuICAgICAgICByZXR1cm4gdGhpcy5kZXBlbmRlbmNpZXM7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogUmV0dXJucyBsb2NhbCBkZXBlbmRlbmNpZXMuXG4gICAgICogQHJldHVybnMge09iamVjdH1cbiAgICAgKi9cbiAgICBnZXRMb2NhbERlcGVuZGVuY2llcygpIHtcbiAgICAgICAgcmV0dXJuIE9iamVjdFxuICAgICAgICAgICAgLmtleXModGhpcy5kZXBlbmRlbmNpZXMpXG4gICAgICAgICAgICAuZmlsdGVyKFxuICAgICAgICAgICAgICAgIGRlcGVuZGVuY3kgPT5cbiAgICAgICAgICAgICAgICAgICAgdGhpcy5yZWdleGVzLmxvY2FsLnRlc3QodGhpcy5kZXBlbmRlbmNpZXNbZGVwZW5kZW5jeV0pIHx8XG4gICAgICAgICAgICAgICAgICAgIHRoaXMucmVnZXhlcy5maWxlLnRlc3QodGhpcy5kZXBlbmRlbmNpZXNbZGVwZW5kZW5jeV0pXG4gICAgICAgICAgICApXG4gICAgICAgICAgICAucmVkdWNlKFxuICAgICAgICAgICAgICAgIChsb2NhbERlcGVuZGVuY2llcywgY3VycmVudERlcGVuZGVuY3kpID0+XG4gICAgICAgICAgICAgICAgICAgIE9iamVjdC5hc3NpZ24oXG4gICAgICAgICAgICAgICAgICAgICAgICBsb2NhbERlcGVuZGVuY2llcyxcbiAgICAgICAgICAgICAgICAgICAgICAgIHsgW2N1cnJlbnREZXBlbmRlbmN5XTogdGhpcy5kZXBlbmRlbmNpZXNbY3VycmVudERlcGVuZGVuY3ldIH1cbiAgICAgICAgICAgICAgICAgICAgKSxcbiAgICAgICAgICAgICAgICB7fVxuICAgICAgICAgICAgKTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBSZXR1cm5zIHJlbW90ZSBkZXBlbmRlbmNpZXMuXG4gICAgICogQHJldHVybnMge09iamVjdH1cbiAgICAgKi9cbiAgICBnZXRSZW1vdGVEZXBlbmRlbmNpZXMoKSB7XG4gICAgICAgIHJldHVybiBPYmplY3RcbiAgICAgICAgICAgIC5rZXlzKHRoaXMuZGVwZW5kZW5jaWVzKVxuICAgICAgICAgICAgLmZpbHRlcihcbiAgICAgICAgICAgICAgICBkZXBlbmRlbmN5ID0+XG4gICAgICAgICAgICAgICAgICAgICF0aGlzLnJlZ2V4ZXMubG9jYWwudGVzdCh0aGlzLmRlcGVuZGVuY2llc1tkZXBlbmRlbmN5XSkgJiZcbiAgICAgICAgICAgICAgICAgICAgIXRoaXMucmVnZXhlcy5maWxlLnRlc3QodGhpcy5kZXBlbmRlbmNpZXNbZGVwZW5kZW5jeV0pXG4gICAgICAgICAgICApXG4gICAgICAgICAgICAucmVkdWNlKFxuICAgICAgICAgICAgICAgIChsb2NhbERlcGVuZGVuY2llcywgY3VycmVudERlcGVuZGVuY3kpID0+XG4gICAgICAgICAgICAgICAgICAgIE9iamVjdC5hc3NpZ24oXG4gICAgICAgICAgICAgICAgICAgICAgICBsb2NhbERlcGVuZGVuY2llcyxcbiAgICAgICAgICAgICAgICAgICAgICAgIHsgW2N1cnJlbnREZXBlbmRlbmN5XTogdGhpcy5kZXBlbmRlbmNpZXNbY3VycmVudERlcGVuZGVuY3ldIH1cbiAgICAgICAgICAgICAgICAgICAgKSxcbiAgICAgICAgICAgICAgICB7fVxuICAgICAgICAgICAgKTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBNZXJnZXMgZGVwZW5kZW5jaWVzIGludG8gb25lIGxpc3QuXG4gICAgICpcbiAgICAgKiBAcGFyYW0ge3N0cmluZ30gZnJvbSAgICAgICAgIC0gZGVzY3JpYmVzIHdoZXJlIHRoZSBkZXBlbmRlbmNpZXMgd2VyZSBzZXRcbiAgICAgKiBAcGFyYW0ge09iamVjdH0gZGVwZW5kZW5jaWVzIC0gZGVwZW5kZW5jaWVzIGxpc3RcbiAgICAgKi9cbiAgICBtZXJnZURlcGVuZGVuY2llcyhmcm9tLCBkZXBlbmRlbmNpZXMpIHtcbiAgICAgICAgaWYgKHRoaXMudmFsaWRhdGVEZXBlbmRlbmNpZXNWZXJzaW9ucyhmcm9tLCBkZXBlbmRlbmNpZXMpKSB7XG4gICAgICAgICAgICB0aGlzLmRldGVjdER1cGxpY2F0ZWREZXBlbmRlbmNpZXMoZnJvbSwgZGVwZW5kZW5jaWVzKTtcbiAgICAgICAgICAgIGFzc2lnbkluKHRoaXMuZGVwZW5kZW5jaWVzLCBkZXBlbmRlbmNpZXMpO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogRGV0ZWN0cyBkZXBlbmRlbmN5IHZlcnNpb24gdHlwZS5cbiAgICAgKiBAcGFyYW0ge3N0cmluZ30gdmVyc2lvbiAtIHZlcnNpb24gc3RyaW5nIG9mIHRoZSBkZXBlbmRlbmN5XG4gICAgICogQHJldHVybiB7c3RyaW5nfVxuICAgICAqL1xuICAgIGRldGVjdERlcGVuZGVuY3lWZXJzaW9uVHlwZSh2ZXJzaW9uKSB7XG4gICAgICAgIGNvbnN0IHR5cGUgPSBPYmplY3Qua2V5cyh0aGlzLnJlZ2V4ZXMpXG4gICAgICAgICAgICAuZmluZChkZXBlbmRlbmN5VHlwZSA9PiB0aGlzLnJlZ2V4ZXNbZGVwZW5kZW5jeVR5cGVdLnRlc3QodmVyc2lvbikpO1xuICAgICAgICByZXR1cm4gdHlwZSB8fCAndmVyc2lvbic7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogVmFsaWRhdGVzIHNlbXZlciBhbmQgZGV0ZWN0IHJhbmdlcy5cbiAgICAgKlxuICAgICAqIEBwYXJhbSB7c3RyaW5nfSBmcm9tICAgICAgICAgLSBkZXNjcmliZXMgd2hlcmUgdGhlIGRlcGVuZGVuY2llcyB3ZXJlIHNldFxuICAgICAqIEBwYXJhbSB7T2JqZWN0fSBkZXBlbmRlbmNpZXMgLSBkZXBlbmRlbmNpZXMgbGlzdFxuICAgICAqL1xuICAgIHZhbGlkYXRlRGVwZW5kZW5jaWVzVmVyc2lvbnMoZnJvbSwgZGVwZW5kZW5jaWVzKSB7XG4gICAgICAgIGNvbnN0IHdhcm5pbmdzU2hvd24gPSB7fTtcbiAgICAgICAgZm9yRWFjaChkZXBlbmRlbmNpZXMsICh2ZXJzaW9uLCBuYW1lKSA9PiB7XG4gICAgICAgICAgICBjb25zdCB0eXBlID0gdGhpcy5kZXRlY3REZXBlbmRlbmN5VmVyc2lvblR5cGUodmVyc2lvbik7XG4gICAgICAgICAgICBpZiAodGhpcy5jaGVja3NbdHlwZV0pIHtcbiAgICAgICAgICAgICAgICBjb25zdCBjaGVjayA9IHRoaXMuY2hlY2tzW3R5cGVdO1xuICAgICAgICAgICAgICAgIGlmIChjaGVjay50eXBlID09PSAncmVnZXgnKSB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGNoZWNrUmVzdWx0ID0gY2hlY2sudGVzdCA9PT0gJ21hdGNoJyA/XG4gICAgICAgICAgICAgICAgICAgICAgICB0aGlzLmNoZWNrc1t0eXBlXS5yZWdleC50ZXN0KHZlcnNpb24pIDpcbiAgICAgICAgICAgICAgICAgICAgICAgICF0aGlzLmNoZWNrc1t0eXBlXS5yZWdleC50ZXN0KHZlcnNpb24pO1xuICAgICAgICAgICAgICAgICAgICBpZiAoIWNoZWNrUmVzdWx0KSB7XG4gICAgICAgICAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYGRlcGVuZGVuY3kgJHtuYW1lfToke3ZlcnNpb259IGZyb20gJHtmcm9tfSBmYWlsZWQgdmVyc2lvbiBgICtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBgY2hlY2sgd2l0aCBtZXNzYWdlOiAke3RoaXMuY2hlY2tzW3R5cGVdLm1lc3NhZ2V9YCk7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgaWYgKGNoZWNrLnR5cGUgPT09ICd3YXJuaW5nJyAmJiAhd2FybmluZ3NTaG93bltjaGVjay5vbmNlTmFtZV0pIHtcbiAgICAgICAgICAgICAgICAgICAgd2FybmluZ3NTaG93bltjaGVjay5vbmNlTmFtZV0gPSB0cnVlO1xuICAgICAgICAgICAgICAgICAgICB0aGlzLmxvZy53YXJuKGBkZXBlbmRlbmN5ICR7bmFtZX06JHt2ZXJzaW9ufSBmcm9tICR7ZnJvbX0gY2F1c2VkIGFgICtcbiAgICAgICAgICAgICAgICAgICAgICAgIGAgd2FybmluZzogJHtjaGVjay5tZXNzYWdlfWApO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgICAgIHJldHVybiB0cnVlO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIERldGVjdHMgZHVwbGljYXRlcy5cbiAgICAgKlxuICAgICAqIEBwYXJhbSB7c3RyaW5nfSBmcm9tICAgICAgICAgLSBkZXNjcmliZXMgd2hlcmUgdGhlIGRlcGVuZGVuY2llcyB3ZXJlIHNldFxuICAgICAqIEBwYXJhbSB7T2JqZWN0fSBkZXBlbmRlbmNpZXMgLSBkZXBlbmRlbmNpZXMgbGlzdFxuICAgICAqL1xuICAgIGRldGVjdER1cGxpY2F0ZWREZXBlbmRlbmNpZXMoZnJvbSwgZGVwZW5kZW5jaWVzKSB7XG4gICAgICAgIGNvbnN0IGR1cGxpY2F0ZXMgPSBpbnRlcnNlY3Rpb24oT2JqZWN0LmtleXMoZGVwZW5kZW5jaWVzKSwgT2JqZWN0LmtleXModGhpcy5kZXBlbmRlbmNpZXMpKTtcbiAgICAgICAgaWYgKGR1cGxpY2F0ZXMubGVuZ3RoID4gMCkge1xuICAgICAgICAgICAgZHVwbGljYXRlcy5mb3JFYWNoKChuYW1lKSA9PiB7XG4gICAgICAgICAgICAgICAgaWYgKGRlcGVuZGVuY2llc1tuYW1lXSAhPT0gdGhpcy5kZXBlbmRlbmNpZXNbbmFtZV0pIHtcbiAgICAgICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBXaGlsZSBwcm9jZXNzaW5nIGRlcGVuZGVuY2llcyBmcm9tICR7ZnJvbX0sIGEgZGVwZW5kZW5jeSBgICtcbiAgICAgICAgICAgICAgICAgICAgICAgIGAke25hbWV9OiAke2RlcGVuZGVuY2llc1tuYW1lXX0gd2FzIGZvdW5kIHRvIGJlIGNvbmZsaWN0aW5nIHdpdGggYSBgICtcbiAgICAgICAgICAgICAgICAgICAgICAgIGBkZXBlbmRlbmN5ICgke3RoaXMuZGVwZW5kZW5jaWVzW25hbWVdfSkgdGhhdCB3YXMgYWxyZWFkeSBkZWNsYXJlZCBpbiBgICtcbiAgICAgICAgICAgICAgICAgICAgICAgICdvdGhlciBtb2R1bGUgb3IgaXQgaXMgdXNlZCBpbiBjb3JlIG9mIHRoZSBlbGVjdHJvbiBhcHAuJyk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSk7XG4gICAgICAgIH1cbiAgICB9XG59XG4iXSwibWFwcGluZ3MiOiI7Ozs7OztBQUNBLElBQUFBLFFBQUEsR0FBQUMsc0JBQUEsQ0FBQUMsT0FBQTtBQUNBLElBQUFDLE9BQUEsR0FBQUQsT0FBQTtBQUVBLElBQUFFLElBQUEsR0FBQUgsc0JBQUEsQ0FBQUMsT0FBQTtBQUF3QixTQUFBRCx1QkFBQUksQ0FBQSxXQUFBQSxDQUFBLElBQUFBLENBQUEsQ0FBQUMsVUFBQSxHQUFBRCxDQUFBLEtBQUFFLE9BQUEsRUFBQUYsQ0FBQTtBQUp4Qjs7QUFNQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDZSxNQUFNRyxtQkFBbUIsQ0FBQztFQUNyQztBQUNKO0FBQ0E7QUFDQTtBQUNBO0VBQ0lDLFdBQVdBLENBQUNDLENBQUMsRUFBRUMsbUJBQW1CLEVBQUU7SUFDaEMsSUFBSSxDQUFDQyxHQUFHLEdBQUcs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