import * as monaco from "monaco-editor";
import { loader } from "@monaco-editor/react";
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import JsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";

let configured = false;

/** Call once before rendering Monaco (e.g. Transform Studio mount). */
export function ensureMonacoConfigured() {
  if (configured) return;
  configured = true;

  if (typeof window !== "undefined") {
    window.MonacoEnvironment = {
      getWorker(_workerId, label) {
        if (label === "json") return new JsonWorker();
        return new EditorWorker();
      },
    };
  }

  loader.config({ monaco });
}

export { monaco };
