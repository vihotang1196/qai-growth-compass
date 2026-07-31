import { forwardRef, useId } from 'react';
import { cn } from '@/lib/cn';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: string;
  error?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, hint, error, id, ...props }, ref) => {
    const autoId = useId();
    const inputId = id ?? autoId;
    const describedBy = error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined;

    return (
      <div className="w-full">
        {label && (
          <label
            htmlFor={inputId}
            className="mb-2 block font-head text-xs font-bold uppercase tracking-wider"
          >
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cn(
            'h-12 w-full border-brutal border-line bg-paper px-4 font-body text-base text-ink',
            'placeholder:opacity-40 focus:outline-none focus:shadow-brutal-sm',
            'disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-brutal-none',
            error && 'bg-muted',
            className,
          )}
          {...props}
        />
        {error ? (
          <p id={`${inputId}-error`} className="mt-2 font-body text-xs font-bold uppercase tracking-wide">
            {error}
          </p>
        ) : hint ? (
          <p id={`${inputId}-hint`} className="mt-2 font-body text-xs opacity-60">
            {hint}
          </p>
        ) : null}
      </div>
    );
  },
);
Input.displayName = 'Input';

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      'w-full border-brutal border-line bg-paper p-4 font-body text-base text-ink',
      'placeholder:opacity-40 focus:outline-none focus:shadow-brutal-sm',
      className,
    )}
    {...props}
  />
));
Textarea.displayName = 'Textarea';
