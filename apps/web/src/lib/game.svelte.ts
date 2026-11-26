import { type ClientMessage, type ErrorCode, PROTOCOL_VERSION, ServerMessage } from "@quorum/protocol";
import { reduceView, type View } from "./view.ts";

interface Options {
  token?: string | undefined;
  onOpen?: (game: GameConnection) => void;
  onWelcome?: (token: string) => void;
  onError?: (code: ErrorCode) => void;
}

// Connexion de jeu partagée par l'écran projeté et l'app joueur. La reconnexion automatique arrive en phase 2.
export class GameConnection {
  view: View | null = $state.raw(null);
  status: "connecting" | "open" | "closed" | "kicked" = $state("connecting");
  error: ErrorCode | null = $state(null);
  #seq = 0;
  #socket: WebSocket;
  #options: Options;

  constructor(options: Options = {}) {
    this.#options = options;
    this.#socket = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`);
    this.#socket.addEventListener("open", () => {
      this.status = "open";
      this.send({ type: "hello", protocolVersion: PROTOCOL_VERSION, token: options.token });
      options.onOpen?.(this);
    });
    this.#socket.addEventListener("message", (event) => {
      this.#receive(event.data);
    });
    this.#socket.addEventListener("close", () => {
      if (this.status !== "kicked") this.status = "closed";
    });
  }

  send(message: ClientMessage): void {
    this.error = null;
    this.#socket.send(JSON.stringify(message));
  }

  close(): void {
    this.#socket.close();
  }

  #receive(data: unknown): void {
    const parsed = ServerMessage.safeParse(typeof data === "string" ? JSON.parse(data) : null);
    if (!parsed.success) return;
    const message = parsed.data;
    if (message.type === "reload") location.reload();
    if (message.type === "welcome") this.#options.onWelcome?.(message.token);
    if (message.type === "error") {
      if (message.code === "kicked") this.status = "kicked";
      else this.error = message.code;
      this.#options.onError?.(message.code);
    }
    ({ view: this.view, seq: this.#seq } = reduceView({ view: this.view, seq: this.#seq }, message));
  }
}
