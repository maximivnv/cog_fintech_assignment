import { buttonClass, textareaClass, type ButtonTone } from "./primitives";

/**
 * A form with a required reason and a submit button. `action` is a server function that reads
 * `reason` plus any `fields` from the FormData and calls a platform action.
 */
export function ReasonForm({
  action,
  submitLabel,
  tone = "primary",
  fields = {},
  placeholder = "Reason",
  disabled = false,
}: {
  action: (formData: FormData) => Promise<void>;
  submitLabel: string;
  tone?: ButtonTone;
  fields?: Record<string, string>;
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <form action={action} className="flex flex-col gap-2">
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <textarea
        name="reason"
        required
        rows={2}
        maxLength={1000}
        placeholder={placeholder}
        disabled={disabled}
        className={textareaClass}
      />
      <div>
        <button type="submit" disabled={disabled} className={buttonClass[tone]}>
          {submitLabel}
        </button>
      </div>
    </form>
  );
}
