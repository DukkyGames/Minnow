import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import {
  BUILTIN_DESIGN_TOOL_IDS,
  STUB_DESIGN_TOOL_ID,
  createStubDesignTool,
  getDesignTool,
  listDesignTools,
  registerBuiltinPlaceholderDesignTools,
  registerDesignTool,
  resetDesignToolRegistryForTests,
  unregisterDesignTool,
  type DesignToolContext,
} from '../../src/design/design-tool.ts';

describe('DesignTool registry', () => {
  afterEach(() => {
    resetDesignToolRegistryForTests();
  });

  test('registerDesignTool + getDesignTool round trip', () => {
    const stub = createStubDesignTool();
    registerDesignTool(stub.tool);
    assert.equal(getDesignTool(STUB_DESIGN_TOOL_ID), stub.tool);
    assert.equal(getDesignTool('missing'), undefined);
  });

  test('registerDesignTool replaces a prior registration for the same id', () => {
    const first = createStubDesignTool();
    const second = createStubDesignTool();
    registerDesignTool(first.tool);
    registerDesignTool(second.tool);
    assert.equal(getDesignTool(STUB_DESIGN_TOOL_ID), second.tool);
    assert.equal(listDesignTools().length, 1);
  });

  test('unregisterDesignTool removes the tool', () => {
    const stub = createStubDesignTool();
    registerDesignTool(stub.tool);
    unregisterDesignTool(STUB_DESIGN_TOOL_ID);
    assert.equal(getDesignTool(STUB_DESIGN_TOOL_ID), undefined);
  });

  test('registerBuiltinPlaceholderDesignTools registers all four strip tool ids exactly once', () => {
    registerBuiltinPlaceholderDesignTools();
    registerBuiltinPlaceholderDesignTools();
    const ids = listDesignTools()
      .map((t) => t.id)
      .sort();
    assert.deepEqual(ids, [...BUILTIN_DESIGN_TOOL_IDS].sort());
  });
});

describe('stub DesignTool contract', () => {
  test('arm() receives context and flips isArmed()', () => {
    const stub = createStubDesignTool();
    assert.equal(stub.isArmed(), false);

    const ctx: DesignToolContext = {
      instanceId: 'workspace-preview',
      host: {} as HTMLElement,
      overlay: {} as DesignToolContext['overlay'],
    };
    stub.tool.arm(ctx);

    assert.equal(stub.isArmed(), true);
    assert.equal(stub.getContext(), ctx);
    assert.deepEqual(stub.getEvents(), ['arm']);
  });

  test('disarm() clears context and flips isArmed() back off', () => {
    const stub = createStubDesignTool();
    const ctx: DesignToolContext = {
      instanceId: 'design',
      host: {} as HTMLElement,
      overlay: {} as DesignToolContext['overlay'],
    };
    stub.tool.arm(ctx);
    stub.tool.disarm();

    assert.equal(stub.isArmed(), false);
    assert.equal(stub.getContext(), null);
    assert.deepEqual(stub.getEvents(), ['arm', 'disarm']);
  });

  test('pointer handlers receive overlay-space coordinates while armed', () => {
    const stub = createStubDesignTool();
    const ctx: DesignToolContext = {
      instanceId: 'workspace-preview',
      host: {} as HTMLElement,
      overlay: {} as DesignToolContext['overlay'],
    };
    stub.tool.arm(ctx);
    stub.resetEvents();

    const raw = {} as PointerEvent;
    stub.tool.onPointerDown?.({ x: 10, y: 20, raw });
    stub.tool.onPointerMove?.({ x: 15, y: 25, raw });
    stub.tool.onPointerUp?.({ x: 15, y: 25, raw });

    assert.deepEqual(stub.getEvents(), ['down:10,20', 'move:15,25', 'up:15,25']);
  });

  test('render() hook is callable and logs an event', () => {
    const stub = createStubDesignTool();
    stub.tool.render?.();
    assert.deepEqual(stub.getEvents(), ['render']);
  });
});
