import React, { useEffect, useState } from "react";
import { Box, render, Text, useApp, useInput } from "ink";

import type { Credentials } from "./types.js";

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

type CredentialField = "username" | "password";

interface CredentialPromptProps {
  onSubmit(credentials: Credentials): void;
  onCancel(error: Error): void;
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

export async function promptForCredentialsInk(enabled: boolean): Promise<Credentials | undefined> {
  if (!enabled || !process.stdin.isTTY || !process.stdout.isTTY) {
    return undefined;
  }

  return new Promise<Credentials>((resolve, reject) => {
    const onSubmit = (credentials: Credentials) => {
      instance.unmount();
      resolve(credentials);
    };

    const onCancel = (error: Error) => {
      instance.unmount();
      reject(error);
    };

    const instance = render(<CredentialPrompt onSubmit={onSubmit} onCancel={onCancel} />, {
      stdout: process.stdout,
      stdin: process.stdin,
      stderr: process.stderr,
      patchConsole: false,
      exitOnCtrlC: false,
    });
  });
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

function CredentialPrompt({ onSubmit, onCancel }: CredentialPromptProps) {
  const { exit } = useApp();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [field, setField] = useState<CredentialField>("username");
  const [errorMessage, setErrorMessage] = useState<string>();

  useInput((inputValue, key) => {
    if (key.ctrl && inputValue === "c") {
      const error = new Error("Credential input cancelled.");
      onCancel(error);
      exit();
      return;
    }

    if (key.return) {
      if (field === "username") {
        setField("password");
        return;
      }

      const trimmedUsername = username.trim();
      if (!trimmedUsername || !password) {
        setErrorMessage("Username and password are required.");
        return;
      }

      onSubmit({ username: trimmedUsername, password });
      exit();
      return;
    }

    if (key.tab) {
      setField((current) => (current === "username" ? "password" : "username"));
      return;
    }

    if (key.backspace || key.delete) {
      setErrorMessage(undefined);
      if (field === "username") {
        setUsername((current) => current.slice(0, -1));
      } else {
        setPassword((current) => current.slice(0, -1));
      }
      return;
    }

    if (key.escape) {
      const error = new Error("Credential input cancelled.");
      onCancel(error);
      exit();
      return;
    }

    if (key.leftArrow || key.rightArrow || key.upArrow || key.downArrow) {
      return;
    }

    if (inputValue) {
      setErrorMessage(undefined);
      if (field === "username") {
        setUsername((current) => current + inputValue);
      } else {
        setPassword((current) => current + inputValue);
      }
    }
  });

  const maskedPassword = password.length > 0 ? "*".repeat(password.length) : "";

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text bold color="cyan">
        Amex Credentials
      </Text>
      <Text color="gray">Enter username and password. Tab switches fields. Enter submits. Esc cancels.</Text>
      <Box marginTop={1} flexDirection="column">
        <Text {...(field === "username" ? { color: "cyan" as const } : {})}>
          {field === "username" ? ">" : " "} Username: {username || ""}
        </Text>
        <Text {...(field === "password" ? { color: "cyan" as const } : {})}>
          {field === "password" ? ">" : " "} Password: {maskedPassword}
        </Text>
      </Box>
      {errorMessage ? (
        <Text color="red">
          {errorMessage}
        </Text>
      ) : null}
    </Box>
  );
}
