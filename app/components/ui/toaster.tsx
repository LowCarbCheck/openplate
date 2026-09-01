import { Toaster as Sonner } from 'sonner';
import { SirenIcon, CheckIcon, AlertTriangleIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ theme, ...props }: ToasterProps) => {
  const { t } = useTranslation();
  return (
    <Sonner
      theme={theme}
      // Sonner labels its region "Notifications alt+T" in English, whatever the
      // page language is — a screen reader on the German site announced an
      // English landmark. The hotkey suffix is sonner's own and stays as is.
      containerAriaLabel={t('ui.toaster.label')}
      className="toaster group"
      icons={{
        error: <SirenIcon className="text-red-500 w-6 h-6" />,
        success: <CheckIcon className="text-green-500 w-6 h-6" />,
        warning: <AlertTriangleIcon className="text-orange-500 w-6 h-6" />,
      }}
      toastOptions={{
        classNames: {
          // `pointer-events-auto` re-arms the toast box itself: the mount site
          // makes the sonner CONTAINER `pointer-events-none` so the band under
          // the header can never swallow a tap meant for the device menu or the
          // nav drawer, and only this box opts back in.
          toast:
            'group toast pointer-events-auto group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg',
          description: 'group-[.toast]:text-muted-foreground',
          error: 'border border-red-500/20',
          success: 'border border-green-500/20',
          warning: 'border border-orange-500/20',
          actionButton: 'group-[.toast]:bg-primary group-[.toast]:text-primary-foreground',
          cancelButton: 'group-[.toast]:bg-zinc-100 group-[.toast]:text-zinc-900 bg-red-500',
          closeButton: 'group-[.toast]:text-muted-foreground bg-white',
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
