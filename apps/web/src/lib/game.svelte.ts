import { type ClientMessage, type ErrorCode, PROTOCOL_VERSION, ServerMessage } from "@quorum/protocol";
import { clockOffset, offsetSample } from "./clock.ts";
import { reduceView, type View } from "./view.ts";

const CLOCK_SAMPLES = 5;

interface Options {
  token?: string | undefined;
  onOpen?: (game: GameConnection) => void;
  // Après `lookup`, la vue de visiteur dit au joueur s'il doit choisir une équipe avant de rejoindre.
  onSnapshot?: (game: GameConnection, view: View) => void;
  onWelcome?: (token: string) => void;
  onError?: (code: ErrorCode) => void;
  // Écran projeté : redemande un jeton animateur à l'API quand le sien a expiré.
  refreshToken?: () => Promise<string>;
}

// Connexion de jeu partagée par l'écran projeté et l'app joueur. Après une coupure, elle se reconnecte
// (n'importe quel nœud fait l'affaire) et reprend là où elle en était grâce à `lastSeq`.
export class GameConnection {
  view: View | null = $state.raw(null);
  status: "connecting" | "open" | "reconnecting" | "closed" | "kicked" = $state("connecting");
  error: ErrorCode | null = $state(null);
  // Écart avec l'horloge du serveur : les comptes à rebours s'alignent sur ses échéances absolues.
  clockOffset = $state(0);
  #clockSamples: number[] = [];
  #seq = 0;
  #token: string | undefined;
  // Une réponse envoyée juste avant une coupure peut se perdre : sans accusé de réception, elle est renvoyée après la reconnexion.
  #pendingAnswer: string | null = null;
  #attempt = 0;
  #stopped = false;
  #options: Options;
  #socket: WebSocket;

  constructor(options: Options = {}) {
    this.#options = options;
    this.#token = options.token;
    this.#socket = this.#connect();
  }

  // Pendant une reconnexion, les écrans désactivent leurs boutons : rien n'est envoyé sur une socket qui n'est pas ouverte.
  send(message: ClientMessage): void {
    this.error = null;
    const text = JSON.stringify(message);
    if (message.type === "answer") this.#pendingAnswer = text;
    if (this.#socket.readyState === WebSocket.OPEN) this.#socket.send(text);
  }

  close(): void {
    this.#stopped = true;
    this.#socket.close();
  }

  #connect(): WebSocket {
    const socket = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`);
    socket.addEventListener("open", () => {
      const first = this.status === "connecting";
      this.status = "open";
      this.#attempt = 0;
      this.send({ type: "hello", protocolVersion: PROTOCOL_VERSION, token: this.#token, lastSeq: this.view ? this.#seq : undefined });
      if (this.#pendingAnswer) socket.send(this.#pendingAnswer);
      this.#clockSamples = [];
      this.#ping();
      if (first) this.#options.onOpen?.(this);
    });
    socket.addEventListener("message", (event) => {
      this.#receive(event.data);
    });
    socket.addEventListener("close", () => {
      if (this.#stopped || this.status === "kicked") return;
      // Sans jeton (le joueur n'a pas encore été accepté), il n'y a rien à reprendre.
      if (!this.#token) {
        this.status = "closed";
        return;
      }
      this.status = "reconnecting";
      const delay = Math.min(5000, 250 * 2 ** this.#attempt++) * (0.5 + Math.random() / 2);
      setTimeout(() => {
        if (!this.#stopped) this.#socket = this.#connect();
      }, delay);
    });
    return socket;
  }

  #receive(data: unknown): void {
    const parsed = ServerMessage.safeParse(typeof data === "string" ? JSON.parse(data) : null);
    if (!parsed.success) return;
    const message = parsed.data;
    if (message.type === "reload") location.reload();
    if (message.type === "welcome") {
      this.#token = message.token;
      this.#options.onWelcome?.(message.token);
    }
    if (message.type === "pong") this.#measure(message.t, message.serverTime);
    if (message.type === "snapshot") this.#options.onSnapshot?.(this, message.view);
    if (message.type === "answer_received" || message.type === "question_ended") this.#pendingAnswer = null;
    if (message.type === "error") this.#fail(message.code);
    ({ view: this.view, seq: this.#seq } = reduceView({ view: this.view, seq: this.#seq }, message));
  }

  #ping(): void {
    const ping: ClientMessage = { type: "ping", t: Date.now() };
    this.#socket.send(JSON.stringify(ping));
  }

  #measure(sentAt: number, serverTime: number): void {
    this.#clockSamples.push(offsetSample(sentAt, Date.now(), serverTime));
    if (this.#clockSamples.length < CLOCK_SAMPLES) this.#ping();
    else this.clockOffset = clockOffset(this.#clockSamples);
  }

  #fail(code: ErrorCode): void {
    // La réponse renvoyée après une coupure était bien arrivée : c'est une réponse enregistrée, pas une erreur.
    if (code === "already_answered") {
      this.#pendingAnswer = null;
      return;
    }
    const { refreshToken } = this.#options;
    if (code === "invalid_token" && refreshToken) {
      void refreshToken().then((token) => {
        this.#token = token;
        this.#socket.close();
      });
      return;
    }
    if (code === "kicked") this.status = "kicked";
    else this.error = code;
    this.#options.onError?.(code);
  }
}
