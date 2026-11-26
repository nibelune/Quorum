import { expect, test } from "vitest";
import { clockOffset, offsetSample } from "./clock.ts";

test("l'écart suppose que le serveur a lu son heure à mi-chemin de l'aller-retour", () => {
  // Envoyé à 1000, reçu à 1100 : le serveur, qui avance de 500 ms, a répondu vers 1050 + 500.
  expect(offsetSample(1000, 1100, 1550)).toBe(500);
});

test("la médiane des écarts écarte un aller-retour ralenti par le réseau", () => {
  expect(clockOffset([498, 502, 2400, 500, 501])).toBe(501);
});
