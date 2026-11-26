<script lang="ts">
  // L'échéance est absolue, à l'heure du serveur : `offset` corrige l'écart avec l'horloge de cet appareil.
  interface Props {
    deadline: number;
    offset: number;
  }

  let { deadline, offset }: Props = $props();
  let now = $state(Date.now());
  let remaining = $derived(Math.max(0, Math.ceil((deadline - now - offset) / 1000)));

  $effect(() => {
    const timer = setInterval(() => {
      now = Date.now();
    }, 200);
    return () => {
      clearInterval(timer);
    };
  });
</script>

<span class={{ urgent: remaining <= 5 }} role="timer" aria-label="{remaining} secondes restantes">{remaining}</span>

<style>
  span {
    display: inline-grid;
    place-items: center;
    width: 3em;
    height: 3em;
    border-radius: 50%;
    font-weight: 800;
    font-variant-numeric: tabular-nums;
    background: var(--brand);
    color: var(--brand-ink);
  }

  .urgent {
    background: var(--danger);
  }
</style>
