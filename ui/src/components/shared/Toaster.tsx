import { Toaster } from 'sonner';

export function ToastProvider() {
  return (
    <Toaster
      position="bottom-right"
      expand={false}
      richColors={false}
      closeButton
      duration={4000}
      toastOptions={{
        className: 'toast-glass',
        style: {
          padding: '12px 16px',
        },
      }}
    />
  );
}
