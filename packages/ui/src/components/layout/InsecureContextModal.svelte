<script>
  import { createEventDispatcher } from "svelte";
  import { TriangleAlert } from "lucide-svelte";
  import Modal from "./Modal.svelte";
  import Button from "../input/Button.svelte";

  const dispatch = createEventDispatcher();
  const origin = window.location.origin;
  let modalRef;

  function onClose() {
    dispatch("close");
  }
</script>

<Modal
  title="Insecure connection"
  width="700px"
  closeOnOverlayClick={false}
  bind:this={modalRef}
  on:close={onClose}
  on:escape={() => modalRef.dismiss()}
>
  <div class="body">
    <div class="callout">
      <span class="callout-icon"><TriangleAlert size="1.25rem" /></span>
      <div class="callout-text">
        <p class="callout-title">
          Obsidian is partially broken on this connection.
        </p>
        <p>
          The browser blocks some APIs from insecure pages, so some of
          Obsidian's features are broken as a result. Please use one of these
          fixes in order to get a properly functioning app:
        </p>
      </div>
    </div>

    <section class="fix">
      <div class="fix-head">
        <span class="fix-title">Serve over HTTPS</span>
        <span class="badge badge-accent">Recommended</span>
      </div>
      <p>
        Serve Ignis over HTTPS with <code>tailscale serve</code> or a TLS
        reverse proxy. Setup is covered in the
        <a
          href="https://ignis.thiefling.com/docs/security/remote-access/#running-without-tls"
          target="_blank"
          rel="noopener">remote access guide</a
        >.
      </p>
    </section>

    <section class="fix">
      <div class="fix-head">
        <span class="fix-title">Treat this origin as secure</span>
        <span class="badge">This browser only</span>
      </div>
      <ol class="steps">
        <li>
          <span class="num">1</span>
          <span class="step-label">Open the Chrome flag</span>
          <span class="field"
            >chrome://flags/#unsafely-treat-insecure-origin-as-secure</span
          >
        </li>
        <li>
          <span class="num">2</span>
          <span class="step-label">Add this origin to the list</span>
          <span class="field">{origin}</span>
        </li>
        <li>
          <span class="num">3</span>
          <span class="step-label">Relaunch Chrome</span>
        </li>
      </ol>
    </section>
  </div>

  <svelte:fragment slot="footer">
    <div class="footer">
      <Button variant="primary" on:click={() => modalRef.dismiss()}>
        Continue
      </Button>
    </div>
  </svelte:fragment>
</Modal>

<style>
  .body {
    padding: 0 1.5rem 0;
    font-size: 0.9rem;
    line-height: 1.5;
    color: var(--text-normal);
  }

  .callout {
    display: flex;
    gap: 0.75rem;
    padding: 0.85rem 1rem;
    margin: 0.5rem 0 1rem;
    border: 1px solid rgba(190, 150, 45, 0.55);
    background: rgba(190, 150, 45, 0.09);
    border-radius: 8px;
  }

  .callout-icon {
    flex-shrink: 0;
    display: flex;
    padding-top: 0.1rem;
    color: var(--text-warning, #d6a935);
  }

  .callout-title {
    margin: 0 0 0.35rem;
    font-weight: 700;
    color: var(--text-warning, #d6a935);
  }

  .callout-text p {
    margin: 0;
  }

  .fix {
    padding: 0.85rem 1rem;
    margin-bottom: 0.75rem;
    border: 1px solid var(--background-modifier-border);
    border-radius: 8px;
  }

  .fix p {
    margin: 0.5rem 0 0;
  }

  .fix-head {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .fix-title {
    font-weight: 600;
    color: var(--text-normal);
  }

  .badge {
    font-size: 0.7rem;
    font-weight: 500;
    padding: 0.1rem 0.55rem;
    border-radius: 999px;
    background: var(--background-modifier-border);
    color: var(--text-muted);
  }

  .badge-accent {
    background: var(--background-modifier-hover);
    color: var(--interactive-accent);
  }

  .steps {
    list-style: none;
    margin: 0.7rem 0 0;
    padding: 0;
  }

  .steps li {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.6rem;
    margin-bottom: 0.5rem;
  }

  .steps li:last-child {
    margin-bottom: 0;
  }

  .num {
    flex-shrink: 0;
    width: 1.4rem;
    height: 1.4rem;
    border-radius: 999px;
    background: var(--background-modifier-border);
    color: var(--text-muted);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.75rem;
    font-weight: 600;
  }

  .step-label {
    flex-shrink: 0;
    color: var(--text-normal);
  }

  .field {
    flex: 1 1 14rem;
    min-width: 0;
    font-family: var(--font-monospace, ui-monospace, monospace);
    font-size: 0.8rem;
    background: var(--background-primary);
    border: 1px solid var(--background-modifier-border);
    border-radius: 5px;
    padding: 0.25rem 0.5rem;
    color: var(--text-normal);
    user-select: all;
    white-space: nowrap;
    overflow-x: auto;
  }

  code {
    font-family: var(--font-monospace, ui-monospace, monospace);
    font-size: 0.85em;
    background: var(--background-primary);
    padding: 1px 5px;
    border-radius: 4px;
  }

  a {
    color: var(--interactive-accent);
  }

  .footer {
    display: flex;
    justify-content: flex-end;
  }
</style>
