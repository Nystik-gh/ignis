<script>
  import { createEventDispatcher } from "svelte";
  import { X } from "lucide-svelte";

  export let title = "";
  export let width = "600px";
  export let closeOnOverlayClick = true;

  const dispatch = createEventDispatcher();

  let overlayEl;

  function close() {
    if (overlayEl) {
      overlayEl.remove();
    }
    dispatch("close");
  }

  function onOverlayClick(e) {
    if (e.target === overlayEl && closeOnOverlayClick) {
      close();
    }
  }

  function onKeydown(e) {
    if (e.key === "Escape") {
      dispatch("escape");
    }
  }

  export function dismiss() {
    close();
  }
</script>

<!-- svelte-ignore a11y-no-static-element-interactions -->
<div
  class="modal-overlay"
  bind:this={overlayEl}
  on:click={onOverlayClick}
  on:keydown={onKeydown}
  on:ignis-back={() => dispatch("escape")}
>
  <div class="modal-shell" style="width: min({width}, 90vw);">
    <div class="modal-header">
      <div class="header-left">
        <slot name="icon" />
        <span class="header-title">{title}</span>
      </div>
      <button class="close-btn" on:click={close} title="Close">
        <X size="1.125rem" />
      </button>
    </div>

    <slot />

    {#if $$slots.footer}
      <div class="modal-footer">
        <slot name="footer" />
      </div>
    {/if}
  </div>
</div>

<style>
  .modal-overlay {
    position: fixed;
    inset: 0;
    z-index: 99999;
    background: rgba(0, 0, 0, 0.4);
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: var(--font-interface);
  }

  .modal-shell {
    background: var(--background-secondary);
    color: var(--text-normal);
    border-radius: 0.75rem;
    max-height: 80vh;
    display: flex;
    flex-direction: column;
    box-shadow: 0 1rem 3rem rgba(0, 0, 0, 0.5);
    overflow: hidden;
  }

  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.5rem 1rem 0.5rem 1.5rem;
    background: var(--background-primary);
    flex-shrink: 0;
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: 0.625rem;
    color: var(--text-muted);
  }

  .header-title {
    font-size: 1rem;
    font-weight: 600;
    color: var(--text-normal);
  }

  .close-btn {
    background: none;
    border: none;
    box-shadow: none;
    color: var(--text-muted);
    cursor: pointer;
    padding: 0.25rem;
    border-radius: 0.25rem;
    display: flex;
    align-items: center;
  }

  .close-btn:hover {
    color: var(--text-normal);
  }

  .modal-footer {
    padding: 0.8rem 1.5rem 0.8rem;
    flex-shrink: 0;
  }
</style>
