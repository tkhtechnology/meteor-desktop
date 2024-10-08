#!/usr/bin/env node
/* eslint-disable global-require */
import fs from 'fs';
import path from 'path';
import assignIn from 'lodash/assignIn';
import program from 'commander';
import shell from 'shelljs';

import meteorDesktop from '../..';
import addScript from '../scripts/utils/addScript';

const { join } = path;
const cmd = process.argv[2];

/* eslint-disable no-console */
const {
    log, error, info, warn
} = console;

/* eslint-enable no-console */

/**
 * Looks for .meteor directory.
 * @param {string} appPath - Meteor app path
 */
function isMeteorApp(appPath) {
    const meteorPath = join(appPath, '.meteor');
    try {
        return fs.statSync(meteorPath).isDirectory();
    } catch (e) {
        return false;
    }
}

/**
 * Just ensures a ddp url is set.
 *
 * @param {string|null} ddpUrl - the url that Meteor app connects to
 * @returns {string|null}
 */
function getDdpUrl(ddpUrl = null) {
    if (!ddpUrl && program.buildMeteor) {
        info('no ddp_url specified, setting default: http://127.0.0.1:3000');
        return 'http://127.0.0.1:3000';
    }
    return ddpUrl;
}

// --------------------------

function collect(val, memo) {
    memo.push(val);
    return memo;
}

program
    .option('-b, --build-meteor', 'runs meteor to obtain the mobile build, kills it after')
    .option('-t, --build-timeout <timeout_in_sec>', 'timeout value when waiting for ' +
        'meteor to build, default 600sec')
    .option('-p, --port <port>', 'port on which meteor is running, when with -b this will be passed to meteor when obtaining the build')
    .option('--production', 'builds meteor app with the production switch, uglifies contents ' +
        'of .desktop, packs app to app.asar')
    .option('-a, --android', 'force adding android as a mobile platform instead of ios')
    .option('-s, --scaffold', 'will scaffold .desktop if not present')
    .option('-i, --ignore-stderr [string]', 'only with -b, strings that when found will not terminate meteor build', collect, [])
    .option('--meteor-settings <path>', 'only with -b, adds --settings options to meteor')
    .option('--prod-debug', 'forces adding dev tools to a production build')
    .option('--ia32', 'generate 32bit installer/package')
    .option('--all-archs', 'generate 32bit and 64bit installers')
    .option('--win', 'generate Windows installer')
    .option('--linux', 'generate Linux installer')
    .option('--mac', 'generate Mac installer')
    .option('-d, --debug', 'run electron with debug switch');


program
    .usage('[command] [options]')
    .version(require('./../../package.json').version, '-V, --version')
    .on('--help', () => {
        log('  [ddp_url] - pass a ddp url if you want to use different one than used in meteor\'s --mobile-server');
        log('              this will also work with -b');
        log('    ');
        log('  Examples:');
        log('');
        log(
            '   ',
            [
                '# cd into meteor dir first',
                'cd /your/meteor/app',
                'meteor --mobile-server=127.0.0.1:3000',
                '',
                '# open new terminal, assuming you have done npm install --save-dev @meteor-community/meteor-desktop',
                'npm run desktop -- init',
                'npm run desktop'
            ].join('\n    ')
        );
        log('\n');
    });


function verifyArgsSyntax() {
    if (process.env.npm_config_argv) {
        let npmArgv;
        try {
            const args = ['-b', '--build-meteor', '-t', '--build-timeout', '-p', '--port',
                '--production', '-a', '--android', '-s', '--scaffold', '--ia32', '--win',
                '--linux', '--all-archs', '--win', '--mac', '--meteor-settings'];
            npmArgv = JSON.parse(process.env.npm_config_argv);
            if (npmArgv.remain.length === 0 && npmArgv.original.length > 2) {
                if (npmArgv.original.some(arg => !!~args.indexOf(arg))) {
                    warn('WARNING: seems that you might used the wrong console syntax, no ` --' +
                        ' ` delimiter was found, be sure you are invoking meteor-desktop with' +
                        ' it when passing commands or options -> ' +
                        '`npm run desktop -- command --option`\n');
                }
            }
        } catch (e) {
            // Not sure if `npm_config_argv` is always present...
        }
    }
}

function meteorDesktopFactory(ddpUrl, production = false) {
    info(`METEOR-DESKTOP v${require('./../../package.json').version}\n`);

    verifyArgsSyntax();

    const input = process.cwd();

    if (!isMeteorApp(input)) {
        error(`not in a meteor app dir\n ${input}`);
        process.exit();
    }

    if (!program.output) {
        program.output = input;
    }

    if (production && !program.production) {
        info('package/build-installer implies setting --production, setting it for you');
    }

    if (!program.buildMeteor) {
        program.port = program.port || 3000;
        info(`REMINDER: your Meteor project should be running now on port ${program.port}\n`);
    }

    if (program.prodDebug) {
        info('!! WARNING: You are adding devTools to a production build !!\n');
    }

    const options = {
        ddpUrl,
        skipMobileBuild: program.buildMeteor ? !program.buildMeteor : true,
        production: program.production || production
    };

    assignIn(options, program);

    return meteorDesktop(
        input,
        program.output,
        options
    );
}

function run(ddpUrl) {
    meteorDesktopFactory(getDdpUrl(ddpUrl)).run();
}

function build(ddpUrl) {
    meteorDesktopFactory(getDdpUrl(ddpUrl)).build();
}

function init() {
    meteorDesktopFactory().init();
}

function justRun() {
    meteorDesktopFactory().justRun();
}

function runPackager(ddpUrl) {
    meteorDesktopFactory(getDdpUrl(ddpUrl), true).runPackager();
}

function buildInstaller(ddpUrl) {
    meteorDesktopFactory(getDdpUrl(ddpUrl), true).buildInstaller();
}

function initTestsSupport() {
    log('installing cross-env, ava, meteor-desktop-test-suite and spectron');
    log('running `meteor npm install --save-dev cross-env ava spectron meteor-desktop-test-suite`');

    const { code } = shell.exec('meteor npm install --save-dev cross-env ava spectron meteor-desktop-test-suite');

    if (code !== 0) {
        warn('could not add cross-env, ava and spectron to your `devDependencies`, please do it' +
            ' manually');
    }

    const test = 'cross-env NODE_ENV=test ava .desktop/**/*.test.js -s --verbose';
    const testWatch = 'cross-env NODE_ENV=test ava .desktop/**/*.test.js -s --verbose' +
        ' --watch --source .desktop';

    function fail() {
        error('\ncould not add entries to `scripts` in package.json');
        log('please try to add it manually\n');
        log(`test-desktop: ${test}`);
        log(`test-desktop-watch: ${testWatch}`);
    }

    const packageJsonPath = path.resolve(
        path.join(process.cwd(), 'package.json')
    );

    addScript('test-desktop', test, packageJsonPath, fail);
    addScript('test-desktop-watch', testWatch, packageJsonPath, fail);

    log('\nadded test-desktop and test-desktop-watch entries');
    log('run the test with `npm run test-desktop`');
}

program
    .command('init')
    .description('scaffolds .desktop dir in the meteor app')
    .action(init);

program
    .command('run [ddp_url]')
    .description('(default) builds and runs desktop app')
    .action(run);

program
    .command('build [ddp_url]')
    .description('builds your desktop app')
    .action(build);

program
    .command('build-installer [ddp_url]')
    .description('creates the installer')
    .action(buildInstaller);

program
    .command('just-run')
    .description('alias for running `electron .` in `.meteor/desktop-build`')
    .action(justRun);

program
    .command('package [ddp_url]')
    .description('runs electron packager')
    .action(runPackager);

program
    .command('init-tests-support')
    .description('prepares project for running functional tests of desktop app')
    .action(initTestsSupport);

if (process.argv.length === 2 || !~('-h|--help|run|init|build|build-installer|just-run|init-tests-support|package'.indexOf(cmd))
) {
    let { argv } = process;
    if (process.argv.length === 2) {
        argv.push('run');
    } else {
        let command = argv.splice(0, 2);
        command = command.concat('run', argv);
        argv = command;
    }
    program.parse(argv);
} else {
    program.parse(process.argv);
}
