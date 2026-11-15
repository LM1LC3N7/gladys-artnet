// -----------------------------------------------------------------------------
// The SDK handlers, wired to the app. Shared by index.js and the tests, so the
// tests run the exact wiring of the container.
// -----------------------------------------------------------------------------

import { ACTIONS, SCENE_ACTIONS } from './constants.js';

export function registerHandlers(gladys, app, logger) {
  // Discovery: the fixtures typed in the configuration (Art-Net nodes do not
  // know the fixtures plugged on their DMX lines).
  gladys.onScanRequest(() => app.scan());
  gladys.onDeviceCreated(() => app.devicesChanged());
  gladys.onDeviceUpdated(() => app.devicesChanged());
  gladys.onDeviceDeleted(() => app.devicesChanged());

  // Commands.
  gladys.onSetValue((device, feature, value) => app.setValue(device, feature, value));

  // Configuration screen buttons.
  gladys.onAction(ACTIONS.TEST, () => app.testNode());
  gladys.onAction(ACTIONS.BLACKOUT, () => app.blackoutAction());

  // Scene action: every fixture at 0.
  gladys.onSceneAction(SCENE_ACTIONS.BLACKOUT, () => app.blackoutScene());

  // Configuration saved by the user.
  gladys.onConfigUpdated((config) => app.configUpdated(config));

  // Connection lifecycle (also after every reconnection to Gladys): /data,
  // the configuration (tried again while it cannot be read), the Discovery,
  // the badges and the status. Nothing is sent to the node here.
  gladys.on('connected', async () => {
    try {
      await app.connected(() => gladys.getConfig());
    } catch (err) {
      logger?.error('Start failed', err);
    }
  });
}
