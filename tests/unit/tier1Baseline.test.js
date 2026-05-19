import chai from 'chai';
import dirty from 'dirty-chai';
import sinonChai from 'sinon-chai';

chai.use(sinonChai);
chai.use(dirty);
const { describe, it } = global;
const { expect } = chai;

/**
 * Baseline smoke tests for Tier 1 package upgrades.
 *
 * These tests verify the expected package versions after the Tier 1 upgrade
 * (lodash 4.18.1, rewire 9.0.1, jsdoc-to-markdown 9.1.3, watch removed).
 * They run as part of npm test to confirm the upgrade landed correctly.
 */
describe('Tier 1 baseline', () => {
    describe('#package.json versions', () => {
        it('should have lodash at 4.18.1 in dependencies', () => {
            /* eslint-disable global-require */
            const pkg = require('../../package.json');
            expect(pkg.dependencies.lodash).to.equal('4.18.1');
        });
        it('should not have watch in devDependencies', () => {
            /* eslint-disable global-require */
            const pkg = require('../../package.json');
            expect(pkg.devDependencies).to.not.have.property('watch');
        });
    });
});
