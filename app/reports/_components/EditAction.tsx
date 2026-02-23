"use client";

import Link from "next/link";
import type { CSSProperties, MouseEventHandler, ReactNode } from "react";

type EditActionBaseProps = {
  ariaLabel?: string;
  className?: string;
  style?: CSSProperties;
  title?: string;
  iconSize?: number;
  children?: ReactNode;
};

type EditActionLinkProps = EditActionBaseProps & {
  href: string;
  onClick?: never;
  disabled?: never;
  type?: never;
};

type EditActionButtonProps = EditActionBaseProps & {
  href?: never;
  onClick: MouseEventHandler<HTMLButtonElement>;
  disabled?: boolean;
  type?: "button" | "submit" | "reset";
};

type EditActionProps = EditActionLinkProps | EditActionButtonProps;

function PencilIcon({ size = 13 }: { size?: number }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 528.899 528.899"
      width={size}
      height={size}
      fill="currentColor"
    >
      <path d="M328.883 89.125 436.473 196.714 164.133 469.054 56.604 361.465 328.883 89.125zM518.113 63.177l-47.981-47.981c-18.543-18.543-48.653-18.543-67.259 0l-45.961 45.961 107.59 107.59 53.611-53.611c14.382-14.383 14.382-37.577 0-51.959zM.3 512.69c-1.958 8.812 5.998 16.708 14.811 14.565l119.891-29.069L27.473 390.597.3 512.69z" />
    </svg>
  );
}

export function EditAction(props: EditActionProps) {
  const {
    ariaLabel = "Edit",
    className = "",
    style,
    title = "Edit",
    iconSize = 13,
    children,
  } = props;

  const baseClassName = `inline-flex h-7 w-7 items-center justify-center rounded border ${className}`.trim();
  const content = (
    <>
      <PencilIcon size={iconSize} />
      {children}
      <span className="sr-only">{ariaLabel}</span>
    </>
  );

  if (typeof (props as EditActionLinkProps).href === "string") {
    const href = (props as EditActionLinkProps).href;
    return (
      <Link
        href={href}
        aria-label={ariaLabel}
        title={title}
        className={baseClassName}
        style={style}
      >
        {content}
      </Link>
    );
  }

  return (
    <button
      type={props.type ?? "button"}
      onClick={props.onClick}
      disabled={props.disabled}
      aria-label={ariaLabel}
      title={title}
      className={baseClassName}
      style={style}
    >
      {content}
    </button>
  );
}
