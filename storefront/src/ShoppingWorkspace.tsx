import { ProductWorkspace, type WorkspaceViewModel } from './ProductWorkspace';
import { useShopping } from './ShoppingProvider';
import './shopping-workspace.css';
/** Product work lives here; the editable brief stays alongside the conversation. */
export function ShoppingWorkspace({
  onSend,
  onStart,
  model,
  focusProductId,
}: {
  onSend?: (message: string) => void;
  onStart?: () => void;
  onReset?: () => void;
  model?: WorkspaceViewModel;
  focusProductId?: string | null;
}) {
  const s = useShopping();
  if (!s && !model) return null;
  return (
    <aside className="shopping-workspace" aria-label="Your shopping workspace">
      {s?.error && (
        <p className="workspace-error" role="alert">
          {s.error}
        </p>
      )}
      <ProductWorkspace
        onAsk={onSend}
        onStart={onStart}
        model={model}
        focusProductId={focusProductId}
      />
    </aside>
  );
}
