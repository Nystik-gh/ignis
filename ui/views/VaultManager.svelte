<script>
  import { onMount } from "svelte";
  import {
    Vault,
    Folder,
    Plus,
    SquarePlus,
    PenLine,
    Trash2,
    Check,
  } from "lucide-svelte";
  import Modal from "../components/layout/Modal.svelte";
  import PromptDialog from "../components/layout/PromptDialog.svelte";
  import ConfirmDialog from "../components/layout/ConfirmDialog.svelte";
  import SearchInput from "../components/input/SearchInput.svelte";
  import Button from "../components/input/Button.svelte";
  import ListItem from "../components/display/ListItem.svelte";
  import PopoverMenu from "../components/menu/PopoverMenu.svelte";

  export let vaultService;

  let vaults = [];
  let searchQuery = "";
  let openMenuId = null;
  let modalRef;

  let activeDialog = null;
  let targetVault = null;
  let dialogValue = "";

  const menuItems = [
    { id: "rename", label: "Rename" },
    { id: "delete", label: "Delete", danger: true },
  ];

  let currentVaultId = vaultService.getCurrentVaultId();

  $: deleteMessage = targetVault
    ? 'Are you sure you want to delete "' + targetVault.name + '"?'
    : "";
  $: filteredVaults = searchQuery
    ? vaults.filter((v) =>
        v.name.toLowerCase().includes(searchQuery.toLowerCase()),
      )
    : vaults;

  async function refreshVaults() {
    try {
      vaults = await vaultService.listVaults();
    } catch {
      vaults = [];
    }
  }

  function openVault(vault) {
    if (vault.id === currentVaultId) {
      modalRef.dismiss();
      return;
    }
    vaultService.openVault(vault.id);
  }

  function toggleMenu(vaultId) {
    if (openMenuId === vaultId) {
      openMenuId = null;
    } else {
      openMenuId = vaultId;
    }
  }

  function onMenuSelect(vault, item) {
    openMenuId = null;
    if (item.id === "rename") {
      showRenameDialog(vault);
    } else if (item.id === "delete") {
      showDeleteDialog(vault);
    }
  }

  function showCreateDialog() {
    dialogValue = "";
    activeDialog = "create";
  }

  function showRenameDialog(vault) {
    targetVault = vault;
    dialogValue = vault.name;
    activeDialog = "rename";
  }

  function showDeleteDialog(vault) {
    targetVault = vault;
    activeDialog = "delete";
  }

  function closeDialog() {
    activeDialog = null;
    targetVault = null;
    dialogValue = "";
  }

  async function onCreateConfirm(e) {
    const name = e.detail.trim();

    if (!name) {
      return;
    }

    try {
      vaults = await vaultService.createVault(name);
    } catch (err) {
      alert("Failed to create vault: " + err.message);
      return;
    }

    closeDialog();
  }

  async function onRenameConfirm(e) {
    const trimmed = e.detail.trim();

    if (!trimmed || trimmed === targetVault.name) {
      closeDialog();
      return;
    }

    const wasCurrentVault = targetVault.id === currentVaultId;

    try {
      vaults = await vaultService.renameVault(targetVault.id, trimmed);
    } catch (err) {
      alert("Failed to rename vault: " + err.message);
      return;
    }

    closeDialog();

    if (wasCurrentVault) {
      currentVaultId = vaultService.getCurrentVaultId();
    }
  }

  async function onDeleteConfirm() {
    try {
      const { wasCurrentVault } = await vaultService.deleteVault(
        targetVault.id,
      );

      closeDialog();

      vaults = await vaultService.listVaults();

      if (wasCurrentVault) {
        vaultService.openVault("");
      }
    } catch (err) {
      alert("Failed to delete vault: " + err.message);
    }
  }

  function onEscape() {
    if (openMenuId) {
      openMenuId = null;
    } else {
      modalRef.dismiss();
    }
  }

  onMount(() => {
    refreshVaults();
  });
</script>

<Modal
  title="Vault Manager"
  width="600px"
  bind:this={modalRef}
  on:escape={onEscape}
  closeOnOverlayClick={false}
>
  <svelte:fragment slot="icon">
    <Vault size="1.25rem" />
  </svelte:fragment>

  <div class="section-header">
    <h3>Vaults</h3>
    <div class="search-wrapper">
      <SearchInput
        value={searchQuery}
        on:input={(e) => {
          searchQuery = e.detail;
        }}
      />
    </div>
  </div>

  <div class="section-body">
    <div class="vault-list">
      {#if vaults.length === 0}
        <div class="empty">No vaults yet. Create one below.</div>
      {:else if filteredVaults.length === 0}
        <div class="empty">No vaults match your search.</div>
      {:else}
        {#each filteredVaults as vault (vault.id)}
          <ListItem
            primary={vault.name}
            secondary={vault.path}
            active={vault.id === currentVaultId}
            on:click={() => openVault(vault)}
          >
            <svelte:fragment slot="icon">
              <Folder size="1.5rem" />
            </svelte:fragment>
            <svelte:fragment slot="default">
              <span class="vault-name">
                {vault.name}
                {#if vault.id === currentVaultId}
                  <span class="active-label">(active)</span>
                  <span class="active-check">&#10003;</span>
                {/if}
              </span>
              <span class="vault-path">{vault.path}</span>
            </svelte:fragment>
            <svelte:fragment slot="action">
              <PopoverMenu
                open={openMenuId === vault.id}
                items={menuItems}
                on:toggle={() => toggleMenu(vault.id)}
                on:select={(e) => onMenuSelect(vault, e.detail)}
              />
            </svelte:fragment>
          </ListItem>
        {/each}
      {/if}
    </div>
  </div>

  <svelte:fragment slot="footer">
    <div class="footer-right">
      <Button variant="ghost" on:click={showCreateDialog}>
        <svelte:fragment slot="icon">
          <Plus size="1rem" />
        </svelte:fragment>
        Create New Vault
      </Button>
    </div>
  </svelte:fragment>
</Modal>

{#if activeDialog === "create"}
  <PromptDialog
    title="Create Vault"
    label="Vault Name:"
    placeholder="My New Vault"
    confirmText="Create Vault"
    bind:value={dialogValue}
    on:confirm={onCreateConfirm}
    on:cancel={closeDialog}
  >
    <svelte:fragment slot="icon">
      <SquarePlus size="1.25rem" />
    </svelte:fragment>
    <svelte:fragment slot="confirmIcon">
      <Plus size="0.875rem" />
    </svelte:fragment>
  </PromptDialog>
{/if}

{#if activeDialog === "rename"}
  <PromptDialog
    title="Rename Item"
    label="New Name:"
    confirmText="Save Name"
    bind:value={dialogValue}
    on:confirm={onRenameConfirm}
    on:cancel={closeDialog}
  >
    <svelte:fragment slot="icon">
      <PenLine size="1.25rem" />
    </svelte:fragment>
    <svelte:fragment slot="confirmIcon">
      <Check size="0.875rem" />
    </svelte:fragment>
  </PromptDialog>
{/if}

{#if activeDialog === "delete" && targetVault}
  <ConfirmDialog
    title="Delete Confirmation"
    message={deleteMessage}
    description="This action cannot be undone. All notes and linked files within this vault will be permanently removed from your system."
    confirmText="Confirm Delete"
    confirmVariant="danger"
    on:confirm={onDeleteConfirm}
    on:cancel={closeDialog}
  >
    <svelte:fragment slot="icon">
      <Trash2 size="1.25rem" />
    </svelte:fragment>
    <svelte:fragment slot="confirmIcon">
      <Check size="0.875rem" />
    </svelte:fragment>
  </ConfirmDialog>
{/if}

<style>
  .section-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.5rem 2rem 0rem 1.5rem;
    flex-shrink: 0;
  }

  .section-header h3 {
    margin: 0;
    font-size: 1.25rem;
    font-weight: 700;
    color: var(--text-normal);
  }

  .search-wrapper {
    width: 11rem;
  }

  .section-body {
    flex: 1;
    display: flex;
    flex-direction: column;
    padding: 1rem 1.1rem 0rem 1rem;
  }

  .vault-list {
    flex: 1;
    overflow-y: auto;
    scrollbar-gutter: stable;
    min-height: 300px;
    max-height: 300px;
    padding: 0rem 0 1rem 0;
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
    border-bottom: 1px solid var(--background-modifier-border);
  }

  .empty {
    color: var(--text-muted);
    padding: 2rem 1rem;
    text-align: center;
    font-size: 0.875rem;
  }

  .vault-name {
    font-weight: 600;
    font-size: 1rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .active-label {
    color: var(--interactive-accent);
    font-weight: 400;
    font-size: 0.875rem;
    margin-left: 0.375rem;
  }

  .active-check {
    color: var(--interactive-accent);
    font-size: 0.875rem;
    margin-left: 0.125rem;
  }

  .vault-path {
    font-size: 0.8125rem;
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .footer-right {
    display: flex;
    justify-content: flex-end;
  }
</style>
