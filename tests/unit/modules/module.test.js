/* eslint-disable no-underscore-dangle */
import chai from 'chai';
import dirty from 'dirty-chai';
import sinonChai from 'sinon-chai';
import sinon from 'sinon';
import proxyquire from 'proxyquire';

chai.use(sinonChai);
chai.use(dirty);
const {
    describe, it, before, after
} = global;
const { expect } = chai;

let ipcMainOnHandler;
const ipcMain = {
    on(event, callback) { ipcMainOnHandler = callback; },
    once(event, callback) { ipcMainOnHandler = callback; },
    removeListener() {},
    removeAllListeners() {}
};
const Electron = { ipcMain, '@noCallThru': true };

let Module;

describe('Module', () => {
    before(() => {
        // module.js has both ES `export default` and CJS `module.exports = Module`
        const loaded = proxyquire('../../../skeleton/modules/module.js', {
            electron: Electron
        });
        Module = loaded.default || loaded;
    });

    describe('#sendInternal', () => {
        it('should throw when no reference to renderer set yet', () => {
            expect(Module.sendInternal.bind(Module, 'test')).to.throw(
                /No reference to renderer process/
            );
        });
        it('should send ipc when renderer is set', () => {
            const rendererMock = { send: sinon.stub(), isDestroyed: () => false };
            // trigger ipcMain.on handler to set the module-level renderer variable
            const mod = new Module('test');
            mod.on('someEvent', () => {});
            ipcMainOnHandler({ sender: rendererMock });
            const arg1 = { some: 'data' };
            const arg2 = 'test';
            Module.sendInternal('event', arg1, arg2);
            expect(rendererMock.send).to.be.calledWith('event', arg1, arg2);
        });
        it('should not send ipc when renderer is destroyed', () => {
            const rendererMock = { send: sinon.stub(), isDestroyed: () => true };
            const mod = new Module('test');
            mod.on('someEvent', () => {});
            ipcMainOnHandler({ sender: rendererMock });
            Module.sendInternal('event');
            expect(rendererMock.send).to.have.callCount(0);
        });
    });
    describe('#getEventName', () => {
        it('should return namespaced event name', () => {
            const mod = new Module('test');
            expect(mod.getEventName('event')).to.equal('test__event');
        });
    });
    describe('#getResponseEventName', () => {
        it('should return namespaced response event name', () => {
            const mod = new Module('test');
            expect(mod.getResponseEventName('event')).to.equal('test__event___response');
        });
    });

    describe('#setDefaultFetchTimeout', () => {
        it('should call fetch with correct timeout', () => {
            const mod = new Module('test');
            const arg1 = { some: 'data' };
            const arg2 = 'test';
            const event = 'yyy';
            mod.setDefaultFetchTimeout(999);
            mod.fetch = sinon.stub();
            mod.call(event, arg1, arg2);
            expect(mod.fetch).to.be.calledWith(event, 999, arg1, arg2);
        });
    });
});
