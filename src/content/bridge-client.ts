import {
  BRIDGE,
  type Capture,
  type CaptureSnapshot,
  postBridgeMessage,
  readBridgeMessage,
} from "@/shared/bridge";

export interface BridgeHandlers {
  onCapture(capture: Capture): void;
  onSnapshot(snapshot: CaptureSnapshot): void;
}

// Listens for MAIN-world captures and asks once for the snapshot taken before this script loaded (F6c).
export function connectBridge(win: Window, handlers: BridgeHandlers): () => void {
  function onMessage(event: MessageEvent): void {
    const capture = readBridgeMessage(event, win, BRIDGE.capture);
    if (capture) {
      handlers.onCapture(capture.capture);
      return;
    }
    const snapshot = readBridgeMessage(event, win, BRIDGE.snapshot);
    if (snapshot) handlers.onSnapshot(snapshot.snapshot);
  }

  win.addEventListener("message", onMessage);
  const disconnect = () => win.removeEventListener("message", onMessage);
  try {
    postBridgeMessage(win, { source: BRIDGE.hello });
  } catch (error) {
    disconnect();
    throw error;
  }
  return disconnect;
}
