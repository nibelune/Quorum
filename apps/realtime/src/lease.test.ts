import { setTimeout as sleep } from "node:timers/promises";
import { GameState } from "@quorum/game-engine";
import { afterEach, expect, test } from "vitest";
import { keys } from "./games.ts";
import { connectHost, createTestGame, joinAs, question, startTestNode } from "./testing.ts";

type TestNode = Awaited<ReturnType<typeof startTestNode>>;
const nodes: TestNode[] = [];
afterEach(async () => {
  await Promise.all(nodes.splice(0).map((node) => node.close()));
});

async function start(): Promise<TestNode> {
  const node = await startTestNode();
  nodes.push(node);
  return node;
}

async function waitFor(condition: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 3000;
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error("Condition jamais remplie");
    await sleep(50);
  }
}

const leaseOf = (node: TestNode, gameId: Parameters<typeof keys>[0]) => node.redis.get(keys(gameId).lease);

test("une partie servie par deux nœuds se joue à travers les deux, coordonnée par un seul", async () => {
  const a = await start();
  const b = await start();
  const { gameId, pin, hostToken } = await createTestGame(a.redis);
  const host = await connectHost(a.url, hostToken);
  const { player } = await joinAs(b.url, pin, "Alice");
  expect(await host.receive("player_joined")).toMatchObject({ nickname: "Alice" });

  host.send({ type: "start" });
  await player.receive("question_started");
  player.send({ type: "answer", questionId: question.id, choiceIndex: 0 });
  expect(await host.receive("question_ended")).toMatchObject({ distribution: [1, 0] });
  expect(await leaseOf(a, gameId)).toMatch(new RegExp(`^(${a.nodeId}|${b.nodeId}):\\d+$`));
});

test("si le coordinateur tombe, un autre nœud reprend la partie là où elle en était", async () => {
  const a = await start();
  const b = await start();
  const { gameId, pin, hostToken } = await createTestGame(a.redis);
  await connectHost(a.url, hostToken);
  await waitFor(async () => (await leaseOf(a, gameId))?.startsWith(a.nodeId) ?? false);
  const host = await connectHost(b.url, hostToken);
  const { player } = await joinAs(b.url, pin, "Alice");

  // Arrêt brutal : le lease n'est pas relâché, b doit attendre qu'il expire.
  await a.close();
  nodes.splice(nodes.indexOf(a), 1);

  host.send({ type: "start" });
  await player.receive("question_started");
  expect(await leaseOf(b, gameId)).toMatch(new RegExp(`^${b.nodeId}:`));
  player.send({ type: "answer", questionId: question.id, choiceIndex: 0 });
  expect((await player.receive("question_ended")).you?.points).toBeGreaterThan(0);
});

test("un nœud qui a perdu le lease n'écrit plus rien, puis reprend quand il se libère", async () => {
  const a = await start();
  const { gameId, pin, hostToken } = await createTestGame(a.redis);
  const host = await connectHost(a.url, hostToken);
  const { player } = await joinAs(a.url, pin, "Alice");

  // Un autre nœud s'empare du lease, comme pendant une longue pause du coordinateur.
  await a.redis.set(keys(gameId).lease, "intrus:999", "PX", 1500);
  host.send({ type: "start" });
  await sleep(500);
  const state = GameState.parse(JSON.parse((await a.redis.get(keys(gameId).state)) ?? "null"));
  expect(state.current.phase).toBe("lobby");

  await player.receive("question_started");
  expect(await leaseOf(a, gameId)).toMatch(new RegExp(`^${a.nodeId}:`));
});
