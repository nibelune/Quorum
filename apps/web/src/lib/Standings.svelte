<script lang="ts">
  import type { Standing } from "@quorum/protocol";

  interface Props {
    standings: Standing[];
    highlight?: string | undefined;
  }

  let { standings, highlight }: Props = $props();
</script>

<ol>
  {#each standings as { nickname, score }, rank (nickname)}
    <li class={{ highlight: nickname === highlight }}>
      <span class="rank">{rank + 1}</span>
      <span class="nickname">{nickname}</span>
      <span class="score">{score}</span>
    </li>
  {/each}
</ol>

<style>
  ol {
    display: grid;
    gap: 0.5rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  li {
    display: grid;
    grid-template-columns: 2.5em 1fr auto;
    align-items: center;
    border-radius: var(--radius);
    padding: 0.6em 1em;
    background: var(--surface);
    color: var(--ink);
    box-shadow: var(--shadow);
  }

  li:first-child {
    background: var(--accent);
  }

  .highlight {
    outline: 3px solid var(--brand);
  }

  .rank,
  .score {
    font-weight: 800;
    font-variant-numeric: tabular-nums;
  }

  .nickname {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
