"use client";

export function DeleteButton({ name, action }: { name: string; action: () => Promise<void> }) {
  return (
    <form
      action={action}
      onSubmit={(event) => {
        if (!window.confirm(`Remove ${name} from the hub?`)) event.preventDefault();
      }}
    >
      <button type="submit" className="text-(--down) underline">
        Remove
      </button>
    </form>
  );
}
