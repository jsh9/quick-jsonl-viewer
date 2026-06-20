import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { createContext, loadExtension } from './support/extensionHarness';

test('activate registers commands and the custom editor provider', () => {
  const harness = loadExtension();
  try {
    const context = createContext();

    harness.extension.activate(context);

    assert.equal(context.subscriptions.length, 3);
    assert.ok(
      harness.fake.registeredCommands.has('quickJsonlViewer.openCurrentFile')
    );
    assert.ok(
      harness.fake.registeredCommands.has('quickJsonlViewer.openSampleFiles')
    );
    assert.equal(harness.fake.providerRegistrations.length, 1);
    assert.equal(
      harness.fake.providerRegistrations[0]?.viewType,
      'quickJsonlViewer.viewer'
    );
    assert.deepEqual(harness.fake.providerRegistrations[0]?.options, {
      supportsMultipleEditorsPerDocument: true,
      webviewOptions: {
        enableFindWidget: true,
        retainContextWhenHidden: true
      }
    });
    harness.extension.deactivate();
  } finally {
    harness.restore();
  }
});
