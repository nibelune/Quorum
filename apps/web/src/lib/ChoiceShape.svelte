<script lang="ts">
  // Chaque choix a une forme et une couleur : on le reconnaît sans distinguer les couleurs.
  interface Props {
    index: number;
    size?: string;
  }

  let { index, size = "1.5rem" }: Props = $props();
</script>

<svg viewBox="0 0 24 24" width={size} height={size} style:color="var(--choice-{index})" aria-hidden="true">
  {#if index === 0}
    <circle cx="12" cy="12" r="9" />
  {:else if index === 1}
    <polygon points="12,3 21.5,20 2.5,20" />
  {:else if index === 2}
    <rect x="3.5" y="3.5" width="17" height="17" rx="2" />
  {:else}
    <polygon points="12,2 14.9,8.6 22,9.3 16.6,14 18.2,21 12,17.3 5.8,21 7.4,14 2,9.3 9.1,8.6" />
  {/if}
</svg>

<style>
  svg {
    flex: none;
    fill: currentColor;
  }
</style>
