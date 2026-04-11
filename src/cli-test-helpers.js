import { PassThrough } from "node:stream";

export function createBufferedStream() {
  let output = "";

  return {
    stream: {
      write(chunk) {
        output += chunk;
      }
    },
    read() {
      return output;
    }
  };
}

export function createTtyOutputStream() {
  const stream = new PassThrough();
  let output = "";
  const waiters = [];

  function flushWaiters() {
    for (let index = waiters.length - 1; index >= 0; index -= 1) {
      const waiter = waiters[index];
      const matched = typeof waiter.pattern === "string"
        ? output.includes(waiter.pattern)
        : waiter.pattern.test(output);

      if (!matched) {
        continue;
      }

      waiters.splice(index, 1);
      waiter.resolve();
    }
  }

  stream.isTTY = true;
  stream.columns = 80;
  stream.rows = 24;
  stream.on("data", (chunk) => {
    output += chunk.toString();
    flushWaiters();
  });

  stream.on("close", () => {
    while (waiters.length > 0) {
      waiters.shift().reject(new Error("TTY output stream closed before the expected prompt was written."));
    }
  });

  return {
    stream,
    read() {
      return output;
    },
    waitFor(pattern) {
      const matched = typeof pattern === "string"
        ? output.includes(pattern)
        : pattern.test(output);

      if (matched) {
        return Promise.resolve();
      }

      return new Promise((resolve, reject) => {
        waiters.push({ pattern, resolve, reject });
      });
    },
    close() {
      stream.destroy();
    }
  };
}

export function createTtyInputStream() {
  const stream = new PassThrough();

  stream.isTTY = true;
  stream.columns = 80;
  stream.rows = 24;

  return {
    stream,
    write(text) {
      stream.write(text);
    },
    end(text = "") {
      stream.end(text);
    },
    close() {
      stream.destroy();
    }
  };
}
