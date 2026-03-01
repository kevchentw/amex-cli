import React, { useEffect, useState } from "react";
import { Box, render, Text } from "ink";

type AuthProgressStatus = "running" | "success" | "error";

interface AuthProgressState {
  step: string;
  detail: string | undefined;
  status: AuthProgressStatus;
}

export interface AuthInkReporter {
  update(step: string, detail?: string): void;
  success(step: string, detail?: string): void;
  fail(step: string, detail?: string): void;
  dispose(): void;
}

const SPINNER_FRAMES = ["-", "\\", "|", "/"];

export function createAuthInkReporter(enabled: boolean): AuthInkReporter | undefined {
  if (!enabled || !process.stdout.isTTY) {
    return undefined;
  }

  const state: AuthProgressState = {
    step: "Preparing login",
    detail: undefined,
    status: "running",
  };

  const instance = render(<AuthProgressView state={state} />, {
    stdout: process.stdout,
    stdin: process.stdin,
    stderr: process.stderr,
    patchConsole: false,
    exitOnCtrlC: false,
  });

  return {
    update(step: string, detail?: string) {
      state.step = step;
      state.detail = detail;
      state.status = "running";
      instance.rerender(<AuthProgressView state={state} />);
    },
    success(step: string, detail?: string) {
      state.step = step;
      state.detail = detail;
      state.status = "success";
      instance.rerender(<AuthProgressView state={state} />);
    },
    fail(step: string, detail?: string) {
      state.step = step;
      state.detail = detail;
      state.status = "error";
      instance.rerender(<AuthProgressView state={state} />);
    },
    dispose() {
      instance.unmount();
    },
  };
}

function AuthProgressView({ state }: { state: AuthProgressState }) {
  const [frameIndex, setFrameIndex] = useState(0);

  useEffect(() => {
    if (state.status !== "running") {
      return;
    }

    const timer = setInterval(() => {
      setFrameIndex((current) => (current + 1) % SPINNER_FRAMES.length);
    }, 120);

    return () => clearInterval(timer);
  }, [state.status]);

  const marker =
    state.status === "running" ? SPINNER_FRAMES[frameIndex] : state.status === "success" ? "OK" : "ERR";
  const markerColor = state.status === "running" ? "cyan" : state.status === "success" ? "green" : "red";

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text bold color="cyan">
        Amex Login
      </Text>
      <Box>
        <Text color={markerColor}>{marker}</Text>
        <Text> </Text>
        <Text>{state.step}</Text>
      </Box>
      {state.detail ? (
        <Text color="gray">
          {state.detail}
        </Text>
      ) : null}
    </Box>
  );
}
