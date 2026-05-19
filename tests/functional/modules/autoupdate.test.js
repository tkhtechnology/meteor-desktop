/* eslint-disable no-console */
// These test were ported and adapted from here
// https://github.com/meteor/cordova-plugin-meteor-webapp/blob/master/tests/www/tests.js

/**
 * Here we will test both localServer and autoupdate.
 *
 * !!!You need to have a free port 3788!!!
 *
 * In Cordova integration the local server is embedded in the autoupdate module. In this
 * Electron integration the localServer and autoupdate are decoupled. Of course it is crucial
 * to test both of them - so here we will also test the localServer's ability to serve meteor
 * app correctly from two paths:
 *      main path - where the currently downloaded version is
 *      parent path - where the last bundled version is
 * The downloaded version always only contains files that have been changed so the app should
 * be served from both paths at the same time.
 *
 * Two similar terms are used below:
 *      meteor server - this is a fake meteor server (the one you would normally have deployed on
 *      your server machine)
 *      local server - this is the local server which is serving the app to the builtin Chrome in
 *      Electron
 *
 * Since we have a lot of `async` here it is crucial to cover the significant ones with try/catch.
 *
 * If you need some more debug telling you why a test failed change the 'showLogs` var below the
 * imports section.
 */
import chai from 'chai';
import dirty from 'dirty-chai';
import sinonChai from 'sinon-chai';
import path from 'path';
import shell from 'shelljs';
import fs from 'fs';
import proxyquire from 'proxyquire';

import paths from '../../helpers/paths';
import { serveVersion } from '../../helpers/autoupdate/meteorServer';
import {
    setUpLocalServer, expectVersionServedToEqual,
    shutdownLocalServer, restartLocalServerAndExpectVersion, expectAssetToBeServed,
    expectAssetServedToContain
} from '../../helpers/autoupdate/localServer';
import { getFakeLogger } from '../../helpers/meteorDesktop';

chai.use(sinonChai);
chai.use(dirty);
const {
    describe, it, before, after
} = global;
const { expect } = chai;

const showLogs = false;
const showErrors = true;

let HCPClient;

let meteorServer;

function exists(checkPath) {
    try {
        fs.accessSync(checkPath);
        return true;
    } catch (e) {
        return false;
    }
}

/**
 * Prepares the autoupdate module for the tests.
 * It also checks if the version served from the local server from the start is the version we
 * are expecting to be served.
 *
 * @param {boolean} printLogs       - whether to print out the logs from autoupdate
 * @param {Function} onNewVersionReady - Function to run on the `onNewVersionReady` system event
 * @param {string} expectedVersion - The version we are expecting to serve from the start
 * @param {Function} errorCallback - The callback which will be fired with autoupdate errors
 * @param {boolean} printErrorLogs - Whether to print errors even if `printLogs` is false
 * @param {boolean} testMode       - Whether to inform autoupdate that this is a test run. Currently
 *                                   when true, autoupdate does not fire the startup timer
 * @param {Object} [appSettings]   - object pass as appSettings to HCPClient
 *
 * @returns {HCPClient}
 */
async function setUpAutoupdate(printLogs = false, onNewVersionReady, expectedVersion = 'version1',
    errorCallback = Function.prototype, printErrorLogs = false,
    testMode = true, appSettings = {}) {
    const autoupdate = new HCPClient({
        log: getFakeLogger(printLogs, printErrorLogs),
        appSettings,
        // fake systemEvents
        eventsBus: {
            on() {
            },
            emit(event) {
                // We want to catch the newVersionReady systemEvent
                if (event === 'newVersionReady') {
                    onNewVersionReady();
                }
            }
        },
        settings: {
            dataPath: paths.autoUpdateVersionsPath,
            bundleStorePath: paths.autoUpdateVersionsPath,
            initialBundlePath: paths.fixtures.bundledWww,
            test: testMode,
            webAppStartupTimeout: 200
        },
        Module: class Module {
            constructor() {
                this.on = () => {
                };
            }
            send(event, message) { // eslint-disable-line class-methods-use-this
                if (printLogs) {
                    console.log('module event sent from hcp:', event, message);
                }
                if (event === 'error') {
                    errorCallback(message);
                }
            }
        }
    });
    autoupdate.init();

    autoupdate.window = {
        reload() {
        }
    };
    try {
        await setUpLocalServer(
            autoupdate.getDirectory(), autoupdate.getParentDirectory()
        );
        await expectVersionServedToEqual(expectedVersion);
    } catch (e) {
        throw new Error(e);
    }
    return autoupdate;
}

/**
 * This runs a normal auto update cycle:
 *  - check for updates
 *  - download new version
 *  - restart to switch to a new version
 * After that it runs tests that should be provided in the `testCallback`.
 * Also verifies the versions we are expecting to see before the update and after.
 *
 * Returns a Promise that resolves/rejects based on the outcome.
 *
 * @param {Function} testCallback - Function with test we want to run after the cycle.
 * @param {string} versionExpectedAfter - Version to expect being served after the cycle.
 * @param {string} versionExpectedBefore - Version to expect being served before the cycle.
 * @param {boolean} doNotResolve - Whether to not resolve the promise automatically.
 * @param {boolean} printErrorLogs - Whether to print errors even if `printLogs` is false.
 * @param {boolean} testMode       - Whether to inform autoupdate that this is a test run.
 * @param {Object} [appSettings]   - object pass as appSettings to HCPClient
 */
function runAutoUpdateTests(testCallback, versionExpectedAfter,
    versionExpectedBefore = 'version1', doNotResolve = false,
    printErrorLogs = showErrors, testMode = true, appSettings) {
    return new Promise((resolve, reject) => {
        let autoupdateRef;

        setUpAutoupdate(showLogs, async () => {
            try {
                await restartLocalServerAndExpectVersion(autoupdateRef, versionExpectedAfter);
                await testCallback(autoupdateRef);
            } catch (e) {
                reject(e);
                return;
            }
            if (!doNotResolve) {
                resolve();
            }
        }, versionExpectedBefore, undefined, printErrorLogs, testMode, appSettings)
            .then((instance) => {
                autoupdateRef = instance;
                instance.checkForUpdates();
            })
            .catch(reject);
    });
}

/**
 * Cleans up the temporary version directory.
 */
function cleanup() {
    const autoupdateJson = path.join(paths.autoUpdateVersionsPath, 'autoupdate.json');
    const versions = path.join(paths.autoUpdateVersionsPath, 'versions');
    if (exists(autoupdateJson)) {
        shell.rm(autoupdateJson);
    }
    if (exists(versions)) {
        shell.rm('-rf', versions);
    }
}

/**
 * Firstly serves `versionToDownload` on fake meteor server.
 * Runs autoupdate cycle, so the app is updated to the version served.
 * Then switches the fake meteor server to serve now the `versionToServeOnMeteorServer`.
 *
 * @param {string} versionToDownload - Version the autoupdate cycle should download.
 * @param {string} versionToServeOnMeteorServerAfter - Version we want to serve on the fake meteor
 *                          server after the autoupdate cycle is finished.
 * @param {boolean} confirmVersion - Whether to fire startupDidComplete.
 */
async function downloadAndServeVersionLocally(versionToDownload, versionToServeOnMeteorServerAfter,
    confirmVersion = true) {
    try {
        meteorServer = await serveVersion(versionToDownload);
        meteorServer.receivedRequests = [];
    } catch (e) {
        throw new Error(e);
    }
    cleanup();
    await runAutoUpdateTests(async (autoupdate) => {
        if (confirmVersion) {
            autoupdate.startupDidComplete();
        }
        try {
            meteorServer = await serveVersion(versionToServeOnMeteorServerAfter);
        } catch (e) {
            throw new Error(e);
        }
    }, versionToDownload);
}


/**
 * Tries to close and cleanup the fake meteor server.
 */
function shutdownMeteorServer() {
    meteorServer.httpServerInstance.close();
    meteorServer.httpServerInstance.destroy();
    meteorServer.receivedRequests = [];
    // meteorServer = null;
}

function waitForTestToFail(delay) {
    return new Promise((resolve) => {
        setTimeout(resolve, delay);
    });
}

function wait(delay) {
    return new Promise((resolve) => {
        setTimeout(() => resolve(), delay);
    });
}

describe('autoupdate', () => {
    before(() => {
        shell.rm('-rf', paths.autoUpdateVersionsPath);
        shell.mkdir('-p', paths.autoUpdateVersionsPath);
        // original-fs is not a real npm package; @noCallThru prevents proxyquire from resolving it,
        // @global ensures the stub propagates to nested requires (e.g. assetBundleManager.js)
        HCPClient = proxyquire('../../../skeleton/modules/autoupdate.js', {
            'original-fs': Object.assign({}, fs, { '@noCallThru': true, '@global': true })
        }).default;
    });

    describe('when updating from the bundled app version to a downloaded version', () => {
        beforeEach(async () => {
            try {
                meteorServer = await serveVersion('version2');
            } catch (e) {
                throw new Error(e);
            }
            cleanup();
        });
        afterEach(() => {
            shutdownMeteorServer();
            shutdownLocalServer();
        });

        it('should only serve the new version after a page reload', async () => {
            await runAutoUpdateTests(Function.prototype, 'version2');
        });

        it('should only download changed files', async () => {
            meteorServer.receivedRequests = [];
            await runAutoUpdateTests(() => {
                expect(meteorServer.receivedRequests).to.include.members([
                    '/__cordova/manifest.json',
                    '/__cordova/app/template.mobileapp.js',
                    '/__cordova/app/3f6275657e6db3a21acb37d0f6c207cf83871e90.map',
                    '/__cordova/some-file',
                    '/__cordova/some-other-file',
                    '/__cordova/']);
                expect(meteorServer.receivedRequests).to.have.a.lengthOf(6);
            }, 'version2');
        });

        it('should still serve assets that haven\'t changed', async () => {
            await runAutoUpdateTests(async () => {
                await expectAssetToBeServed('some-text.txt');
            }, 'version2');
        });

        it('should remember the new version after a restart', async () => {
            await runAutoUpdateTests(async (autoupdate) => {
                autoupdate.initializeAssetBundles();
                autoupdate.onReset();
                await expectVersionServedToEqual('version2');
            }, 'version2');
        });
    });

    describe('when updating from a downloaded app version to another downloaded version', () => {
        beforeEach(async () => {
            await downloadAndServeVersionLocally('version2', 'version3');
        });
        afterEach(() => {
            shutdownMeteorServer();
            shutdownLocalServer();
        });

        it('should only serve the new verson after a page reload', async () => {
            await runAutoUpdateTests(Function.prototype, 'version3', 'version2');
        });

        it('should only download changed files', async () => {
            meteorServer.receivedRequests = [];
            await runAutoUpdateTests(() => {
                expect(meteorServer.receivedRequests).to.include.members([
                    '/__cordova/manifest.json',
                    '/__cordova/',
                    '/__cordova/app/template.mobileapp.js',
                    '/__cordova/app/36e96c1d40459ae12164569599c9c0a203b36db7.map',
                    '/__cordova/some-file']);
                expect(meteorServer.receivedRequests).to.have.a.lengthOf(5);
            }, 'version3', 'version2');
        });

        it('should still serve assets that haven\'t changed', async () => {
            await runAutoUpdateTests(async () => {
                await expectAssetToBeServed('some-text.txt');
            }, 'version3', 'version2');
        });

        it('should delete the old version after startup completes', async () => {
            await runAutoUpdateTests(async (autoupdate) => {
                expect(
                    autoupdate
                        .assetBundleManager
                        .downloadedAssetBundleWithVersion('version2')
                ).to.exist();

                await new Promise((resolve, reject) => {
                    autoupdate.startupDidComplete((status) => {
                        try {
                            expect(status[0].state).to.be.true();
                            expect(
                                autoupdate
                                    .assetBundleManager
                                    .downloadedAssetBundleWithVersion('version2')
                            ).to.not.exist();
                            resolve();
                        } catch (e) {
                            reject(e);
                        }
                    });
                });
            }, 'version3', 'version2');
        });

        it('should remember the new version after a restart', async () => {
            await runAutoUpdateTests(async (autoupdate) => {
                autoupdate.initializeAssetBundles();
                autoupdate.onReset();
                await expectVersionServedToEqual('version3');
            }, 'version3', 'version2');
        });
    });

    describe('when updating from a downloaded app version to the bundled version', () => {
        beforeEach(async () => {
            await downloadAndServeVersionLocally('version2', 'version1');
        });
        afterEach(() => {
            shutdownMeteorServer();
            shutdownLocalServer();
        });

        it('should only serve the new verson after a page reload', async () => {
            await runAutoUpdateTests(Function.prototype, 'version1', 'version2');
        });

        it('should only download the manifest', async () => {
            meteorServer.receivedRequests = [];
            await runAutoUpdateTests(() => {
                expect(meteorServer.receivedRequests).to.deep.equal([
                    '/__cordova/manifest.json'
                ]);
            }, 'version1', 'version2');
        });

        it('should still serve assets that haven\'t changed', async () => {
            await runAutoUpdateTests(async () => {
                await expectAssetToBeServed('some-text.txt');
            }, 'version1', 'version2');
        });

        it('should not redownload the bundled version', async () => {
            await runAutoUpdateTests((autoupdate) => {
                expect(
                    autoupdate
                        .assetBundleManager
                        .downloadedAssetBundleWithVersion('version1')
                ).to.not.exist();
            }, 'version1', 'version2');
        });

        it('should delete the old version after startup completes', async () => {
            await runAutoUpdateTests(async (autoupdate) => {
                expect(
                    autoupdate
                        .assetBundleManager
                        .downloadedAssetBundleWithVersion('version2')
                ).to.exist();

                await new Promise((resolve, reject) => {
                    autoupdate.startupDidComplete((status) => {
                        try {
                            expect(status[0].state).to.be.true();
                            expect(
                                autoupdate
                                    .assetBundleManager
                                    .downloadedAssetBundleWithVersion('version2')
                            ).to.not.exist();
                            resolve();
                        } catch (e) {
                            reject(e);
                        }
                    });
                });
            }, 'version1', 'version2');
        });

        it('should remember the new version after a restart', async () => {
            await runAutoUpdateTests(async (autoupdate) => {
                autoupdate.initializeAssetBundles();
                autoupdate.onReset();
                await expectVersionServedToEqual('version1');
            }, 'version1', 'version2');
        });
    });

    describe('when checking for updates while there is no new version', () => {
        beforeEach(async () => {
            await downloadAndServeVersionLocally('version2', 'version2');
        });
        afterEach(() => {
            shutdownMeteorServer();
            shutdownLocalServer();
        });

        it('should not invoke the onNewVersionReady callback', async () => {
            await Promise.race([
                runAutoUpdateTests(() => {
                    throw new Error('onVersionReady invoked unexpectedly');
                }, 'version2', 'version2'),
                waitForTestToFail(1000)
            ]);
        });

        it('should not download any files except for the manifest', async () => {
            const autoupdate = await setUpAutoupdate(showLogs, () => {
            }, 'version2', undefined, showErrors);
            meteorServer.receivedRequests = [];
            autoupdate.checkForUpdates();
            await waitForTestToFail(500);
            expect(meteorServer.receivedRequests).to.deep.equal([
                '/__cordova/manifest.json'
            ]);
        });
    });

    describe('when downloading a missing asset', () => {
        beforeEach(async () => {
            try {
                meteorServer = await serveVersion('version2_with_missing_asset');
            } catch (e) {
                throw new Error(e);
            }
            cleanup();
        });
        afterEach(() => {
            shutdownMeteorServer();
            shutdownLocalServer();
        });

        it('should invoke the onError callback with an error', async () => {
            await new Promise((resolve, reject) => {
                setUpAutoupdate(showLogs, () => {
                }, 'version1', (error) => {
                    try {
                        expect(error).to.include('non-success status code 404 for asset:' +
                            ' app/template.mobileapp.js');
                        resolve();
                    } catch (e) {
                        reject(e);
                    }
                }, false).then((autoupdate) => {
                    autoupdate.checkForUpdates();
                }).catch(reject);
            });
        });

        it('should not invoke the onNewVersionReady callback', async () => {
            await Promise.race([
                runAutoUpdateTests(() => {
                    throw new Error('onVersionReady invoked unexpectedly');
                }, 'version2_with_missing_asset', 'version1', false, false),
                waitForTestToFail(1000)
            ]);
        });
    });

    describe('when downloading an invalid asset', () => {
        beforeEach(async () => {
            try {
                meteorServer = await serveVersion('version2_with_invalid_asset');
            } catch (e) {
                throw new Error(e);
            }
            cleanup();
        });
        afterEach(() => {
            shutdownMeteorServer();
            shutdownLocalServer();
        });

        it('should invoke the onError callback with an error', async () => {
            await new Promise((resolve, reject) => {
                setUpAutoupdate(showLogs, () => {
                }, 'version1', (error) => {
                    try {
                        expect(error).to.include('hash mismatch for asset: ' +
                            'app/template.mobileapp.js');
                        resolve();
                    } catch (e) {
                        reject(e);
                    }
                }, false).then((autoupdate) => {
                    autoupdate.checkForUpdates();
                }).catch(reject);
            });
        });

        it('should not invoke the onNewVersionReady callback', async () => {
            await Promise.race([
                runAutoUpdateTests(() => {
                    throw new Error('onVersionReady invoked unexpectedly');
                }, 'version2_with_invalid_asset', 'version1', false, false),
                waitForTestToFail(1000)
            ]);
        });
    });

    describe('when downloading an index page with the wrong version', () => {
        beforeEach(async () => {
            try {
                meteorServer = await serveVersion('version2_with_version_mismatch');
            } catch (e) {
                throw new Error(e);
            }
            cleanup();
        });
        afterEach(() => {
            shutdownMeteorServer();
            shutdownLocalServer();
        });

        it('should invoke the onError callback with an error', async () => {
            await new Promise((resolve, reject) => {
                setUpAutoupdate(showLogs, () => {
                }, 'version1', (error) => {
                    try {
                        expect(error).to.include('version mismatch for index page, expected: version2,' +
                            ' actual: version3');
                        resolve();
                    } catch (e) {
                        reject(e);
                    }
                }, false).then((autoupdate) => {
                    autoupdate.checkForUpdates();
                }).catch(reject);
            });
        });

        it('should not invoke the onNewVersionReady callback', async () => {
            await Promise.race([
                runAutoUpdateTests(() => {
                    throw new Error('onVersionReady invoked unexpectedly');
                }, 'version2_with_version_mismatch', 'version1', false, false),
                waitForTestToFail(1000)
            ]);
        });
    });

    describe('when downloading an index page with a missing ROOT_URL', () => {
        beforeEach(async () => {
            try {
                meteorServer = await serveVersion('missing_root_url');
            } catch (e) {
                throw new Error(e);
            }
            cleanup();
        });
        afterEach(() => {
            shutdownMeteorServer();
            shutdownLocalServer();
        });

        it('should invoke the onError callback with an error', async () => {
            await new Promise((resolve, reject) => {
                setUpAutoupdate(showLogs, () => {
                }, 'version1', (error) => {
                    try {
                        expect(error).to.include('could not find ROOT_URL in downloaded asset bundle');
                        resolve();
                    } catch (e) {
                        reject(e);
                    }
                }, false).then((autoupdate) => {
                    autoupdate.checkForUpdates();
                }).catch(reject);
            });
        });

        it('should not invoke the onNewVersionReady callback', async () => {
            await Promise.race([
                runAutoUpdateTests(() => {
                    throw new Error('onVersionReady invoked unexpectedly');
                }, 'missing_root_url', 'version1', false, false),
                waitForTestToFail(1000)
            ]);
        });
    });

    describe('when downloading an index page with the wrong ROOT_URL', () => {
        beforeEach(async () => {
            await downloadAndServeVersionLocally('127.0.0.1_root_url', 'wrong_root_url');
        });
        afterEach(() => {
            shutdownMeteorServer();
            shutdownLocalServer();
        });

        it('should invoke the onError callback with an error', async () => {
            await new Promise((resolve, reject) => {
                setUpAutoupdate(showLogs, () => {
                }, '127.0.0.1_root_url', (error) => {
                    try {
                        expect(error).to.include('ROOT_URL in downloaded asset bundle would change ' +
                            'current ROOT_URL to localhost.');
                        resolve();
                    } catch (e) {
                        reject(e);
                    }
                }, false).then((autoupdate) => {
                    autoupdate.checkForUpdates();
                }).catch(reject);
            });
        });

        it('should not invoke the onNewVersionReady callback', async () => {
            await Promise.race([
                runAutoUpdateTests(() => {
                    throw new Error('onVersionReady invoked unexpectedly');
                }, 'wrong_root_url', '127.0.0.1_root_url', false, false),
                waitForTestToFail(1000)
            ]);
        });
    });

    describe('when downloading an index page with a missing appId', () => {
        beforeEach(async () => {
            try {
                meteorServer = await serveVersion('missing_app_id');
            } catch (e) {
                throw new Error(e);
            }
            cleanup();
        });
        afterEach(() => {
            shutdownMeteorServer();
            shutdownLocalServer();
        });

        it('should invoke the onError callback with an error', async () => {
            await new Promise((resolve, reject) => {
                setUpAutoupdate(showLogs, () => {
                }, 'version1', (error) => {
                    try {
                        expect(error).to.include('could not find appId in downloaded asset bundle');
                        resolve();
                    } catch (e) {
                        reject(e);
                    }
                }, false).then((autoupdate) => {
                    autoupdate.checkForUpdates();
                }).catch(reject);
            });
        });

        it('should not invoke the onNewVersionReady callback', async () => {
            await Promise.race([
                runAutoUpdateTests(() => {
                    throw new Error('onVersionReady invoked unexpectedly');
                }, 'missing_app_id', 'version1', false, false),
                waitForTestToFail(1000)
            ]);
        });
    });

    describe('when downloading an index page with the wrong appId', () => {
        beforeEach(async () => {
            try {
                meteorServer = await serveVersion('wrong_app_id');
            } catch (e) {
                throw new Error(e);
            }
            cleanup();
        });
        afterEach(() => {
            shutdownMeteorServer();
            shutdownLocalServer();
        });

        it('should invoke the onError callback with an error', async () => {
            await new Promise((resolve, reject) => {
                setUpAutoupdate(showLogs, () => {
                }, 'version1', (error) => {
                    try {
                        expect(error).to.include('appId in downloaded asset bundle does not match ' +
                            'current appId');
                        resolve();
                    } catch (e) {
                        reject(e);
                    }
                }, false).then((autoupdate) => {
                    autoupdate.checkForUpdates();
                }).catch(reject);
            });
        });

        it('should not invoke the onNewVersionReady callback', async () => {
            await Promise.race([
                runAutoUpdateTests(() => {
                    throw new Error('onVersionReady invoked unexpectedly');
                }, 'wrong_app_id', 'version1', false, false),
                waitForTestToFail(1000)
            ]);
        });
    });

    describe('when downloading a version with a missing cordovaCompatibilityVersion', () => {
        beforeEach(async () => {
            try {
                meteorServer = await serveVersion('missing_cordova_compatibility_version');
            } catch (e) {
                throw new Error(e);
            }
            cleanup();
        });
        afterEach(() => {
            shutdownMeteorServer();
            shutdownLocalServer();
        });

        it('should invoke the onError callback with an error', async () => {
            await new Promise((resolve, reject) => {
                setUpAutoupdate(showLogs, () => {
                }, 'version1', (error) => {
                    try {
                        expect(error).to.include('Asset manifest does not have a ' +
                            'cordovaCompatibilityVersion');
                        resolve();
                    } catch (e) {
                        reject(e);
                    }
                }, false).then((autoupdate) => {
                    autoupdate.checkForUpdates();
                }).catch(reject);
            });
        });

        it('should not invoke the onNewVersionReady callback', async () => {
            await Promise.race([
                runAutoUpdateTests(() => {
                    throw new Error('onVersionReady invoked unexpectedly');
                }, 'missing_cordova_compatibility_version', 'version1', false, false),
                waitForTestToFail(1000)
            ]);
        });
    });

    // Commented out as the cordova compatibility check is disabled in this autoupdate integration.
    // That is of course because we have Electron, not Cordova integration.
    /*
     describe('when downloading a version with a different cordovaCompatibilityVersion', () => {
     beforeEach(async () => {
     try {
     meteorServer = await serveVersion('different_cordova_compatibility_version');
     } catch (e) {
     throw new Error(e);
     }
     cleanup();
     });
     afterEach(() => {
     closeMeteorServer();
     shutdownLocalServer();
     });
     it('should invoke the onError callback with an error', async (done) => {
     const autoupdate = await setUpAutoupdate(false, () => {
     }, 'version1', (error) => {
     expect(error).to.include('Skipping downloading new version because the Cordova ' +
     'platform version or plugin versions have changed and are potentially ' +
     'incompatible');
     done();
     });
     autoupdate.checkForUpdates();
     });

     it('should not invoke the onNewVersionReady callback', async (done) => {
     await runAutoUpdateTests(done, () => {
     done('onVersionReady invoked unexpectedly');
     }, 'different_cordova_compatibility_version', 'version1');
     waitForTestToFail(1000, done);
     });
     });
     */

    describe('when resuming a partial download with the same version', () => {
        let autoupdate;
        beforeEach(async () => {
            cleanup();
            const downloadingPath = path.join(
                paths.autoUpdateVersionsPath, 'Downloading'
            );
            if (exists(downloadingPath)) {
                shell.rm('-rf', downloadingPath);
            }
            shell.mkdir(downloadingPath);
            shell.cp('-r', path.join(
                paths.fixtures.partiallyDownloadableVersions, 'version2', '*'
            ), downloadingPath);
            meteorServer = await serveVersion('version2');
            meteorServer.receivedRequests = [];

            await new Promise((resolve, reject) => {
                setUpAutoupdate(showLogs, async () => {
                    resolve();
                }, 'version1', undefined, showErrors)
                    .then((instance) => {
                        autoupdate = instance;
                        instance.checkForUpdates();
                    })
                    .catch(reject);
            });
        });
        afterEach(() => {
            shutdownMeteorServer();
            shutdownLocalServer();
        });

        it('should only download the manifest, the index page, and the remaining assets', () => {
            expect(meteorServer.receivedRequests).to.include.members([
                '/__cordova/manifest.json',
                '/__cordova/',
                '/__cordova/app/template.mobileapp.js',
                '/__cordova/app/3f6275657e6db3a21acb37d0f6c207cf83871e90.map']);
        });

        it('should only serve the new version after a page reload', async () => {
            await restartLocalServerAndExpectVersion(autoupdate, 'version2');
        });

        it('should serve assets that have been downloaded before', async () => {
            await restartLocalServerAndExpectVersion(autoupdate, 'version2');
            await expectAssetServedToContain('some-file', 'some-file (changed)');
        });
    });

    describe('when resuming a partial download with a different version', () => {
        let autoupdate;
        beforeEach(async () => {
            cleanup();
            const downloadingPath = path.join(
                paths.autoUpdateVersionsPath, 'Downloading'
            );
            if (exists(downloadingPath)) {
                shell.rm('-rf', downloadingPath);
            }
            shell.mkdir(downloadingPath);
            shell.cp('-r', path.join(
                paths.fixtures.partiallyDownloadableVersions, 'version2', '*'
            ), downloadingPath);
            meteorServer = await serveVersion('version3');
            meteorServer.receivedRequests = [];

            await new Promise((resolve, reject) => {
                setUpAutoupdate(showLogs, async () => {
                    resolve();
                }, 'version1', undefined, showErrors)
                    .then((instance) => {
                        autoupdate = instance;
                        instance.checkForUpdates();
                    })
                    .catch(reject);
            });
        });

        afterEach(() => {
            shutdownMeteorServer();
            shutdownLocalServer();
        });

        it('should only download the manifest, the index page, and the remaining assets', () => {
            expect(meteorServer.receivedRequests).to.include.members([
                '/__cordova/manifest.json',
                '/__cordova/',
                '/__cordova/app/template.mobileapp.js',
                '/__cordova/app/36e96c1d40459ae12164569599c9c0a203b36db7.map',
                '/__cordova/some-file']);
        });

        it('should only serve the new verson after a page reload', async () => {
            await restartLocalServerAndExpectVersion(autoupdate, 'version3');
        });

        it('should serve assets that have been downloaded before', async () => {
            await restartLocalServerAndExpectVersion(autoupdate, 'version3');
            await expectAssetToBeServed('some-other-file');
        });

        it('should serve changed assets even if they have been downloaded before', async () => {
            await restartLocalServerAndExpectVersion(autoupdate, 'version3');
            await expectAssetServedToContain('some-file', 'some-file (changed again)');
        });
    });

    /**
     * Additional tests that are going beyond what is currently tested in the meteor cordova webapp.
     */

    describe('when startupDidComplete is not fired', () => {
        afterEach(() => {
            shutdownMeteorServer();
            shutdownLocalServer();
            cleanup();
        });

        it('should fallback to last known good version', async () => {
            await downloadAndServeVersionLocally('version2', 'version3');

            await runAutoUpdateTests(
                async (autoupdate) => {
                    await wait(500);
                    expect(autoupdate.getPendingVersion()).to.equal('version2');
                    expect(autoupdate.config.blacklistedVersions).to.contain('version3');
                },
                'version3', 'version2', false, undefined, false
            );
        });

        it('should fallback to initial asset bundle', async () => {
            meteorServer = await serveVersion('version2');
            await runAutoUpdateTests(
                async (autoupdate) => {
                    await wait(500);
                    expect(autoupdate.getPendingVersion()).to.equal('version1');
                    expect(autoupdate.config.blacklistedVersions).to.contain('version2');
                },
                'version2', 'version1', false, undefined, false
            );
        });
    });

    describe('when version is blacklisted', () => {
        afterEach(() => {
            shutdownMeteorServer();
            shutdownLocalServer();
        });

        it('should not download it', async () => {
            meteorServer = await serveVersion('version2');
            await new Promise((resolve, reject) => {
                setUpAutoupdate(showLogs, () => {
                }, 'version1', (error) => {
                    try {
                        expect(error).to.include('skipping downloading blacklisted version');
                        resolve();
                    } catch (e) {
                        reject(e);
                    }
                }, false).then((autoupdate) => {
                    autoupdate.config.blacklistedVersions = ['version2'];
                    autoupdate.checkForUpdates();
                }).catch(reject);
            });
        });
    });

    describe('when desktopHCP', () => {
        beforeEach(async () => {
            meteorServer = await serveVersion('version2');
            cleanup();
        });
        afterEach(() => {
            shutdownMeteorServer();
            shutdownLocalServer();
        });

        it('is set to false then should not emit new version', async () => {
            await Promise.race([
                runAutoUpdateTests(() => {
                    throw new Error('onVersionReady invoked unexpectedly');
                }, 'version2', 'version1', true, false, true, { desktopHCP: false }),
                waitForTestToFail(1000)
            ]);
        });

        it('is set to true then should emit new version', async () => {
            await runAutoUpdateTests(Function.prototype, 'version2', 'version1', false, false, true, { desktopHCP: true });
        });
    });
});
