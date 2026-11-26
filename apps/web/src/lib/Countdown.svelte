<script lang="ts">
  // L'échéance est absolue : chaque écran calcule le temps restant avec sa propre horloge (synchronisée en phase 2).
  interface Props {
    deadline: number;
  }

  let { deadline }: Props = $props();
  let now = $state(Date.now());
  let remaining = $derived(Math.max(0, Math.ceil((deadline - now) / 1000)));

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
