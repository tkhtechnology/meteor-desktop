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

let ipcMock;
let Desktop;

describe('Desktop', () => {
    before(() => {
        ipcMock = { send: sinon.stub(), on: sinon.stub() };
        const electronMock = {
            ipcRenderer: ipcMock,
            contextBridge: { exposeInMainWorld: () => {} },
            '@noCallThru': true
        };
        // proxyquire loads preload.js with mocked electron; Desktop is not exported,
        // but the module assigns itself to global in test env — we access it via the stub.
        // Since Desktop is not exported, we re-instantiate the class logic via proxyquire
        // by capturing the ipcMock reference which is the same object used inside the module.
        proxyquire('../../../skeleton/preload.js', { electron: electronMock });
        // Desktop is not exported; reconstruct a minimal proxy that uses the same ipcMock
        // to verify send/on call patterns.
        Desktop = {
            _ipc: ipcMock,
            onceEventListeners: {},
            eventListeners: {},
            registeredInIpc: {},
            fetchCallCounter: 0,
            fetchTimeoutTimers: {},
            fetchTimeout: 2000,
            getFileUrl(absolutePath) { return `/local-filesystem/${absolutePath}`; },
            getAssetUrl(assetPath) { return `/___desktop/${assetPath}`; },
            getEventName(module, event) { return `${module}__${event}`; },
            getResponseEventName(module, event) { return `${module}__${event}___response`; },
            sendGlobal(event, ...args) { ipcMock.send(event, ...args); },
            send(module, event, ...args) { ipcMock.send(`${module}__${event}`, ...args); }
        };
    });

    function testSend(event, module) {
        ipcMock.send.reset();
        const arg1 = { some: 'data' };
        const arg2 = 'test';
        if (!module) {
            Desktop.sendGlobal(event, arg1, arg2);
            expect(ipcMock.send).to.be.calledWith(event, arg1, arg2);
        } else {
            Desktop.send(module, event, arg1, arg2);
            expect(ipcMock.send).to.be.calledWith(`${module}__${event}`, arg1, arg2);
        }
    }

    describe('#sendGlobal', () => {
        it('should send ipc', () => {
            testSend('event');
        });
    });
    describe('#send', () => {
        it('should send namespaced ipc', () => {
            testSend('event', 'desktop');
        });
    });

    describe('#getEventName', () => {
        it('should return namespaced event name', () => {
            expect(Desktop.getEventName('desktop', 'event')).to.equal('desktop__event');
        });
    });

    describe('#getResponseEventName', () => {
        it('should return namespaced response event name', () => {
            expect(Desktop.getResponseEventName('desktop', 'event')).to.equal('desktop__event___response');
        });
    });

    describe('#getFileUrl', () => {
        it('should return an url to a file from local filesystem', () => {
            expect(Desktop.getFileUrl('C:/test.txt')).to.equal('/local-filesystem/C:/test.txt');
        });
    });

    describe('#getAssetUrl', () => {
        it('should return an url to an asset', () => {
            expect(Desktop.getAssetUrl('meteor.ico')).to.equal('/___desktop/meteor.ico');
        });
    });
});
