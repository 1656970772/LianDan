import { useState } from "react";

interface EntityIconProps {
  src?: string;
  name: string;
  size?: "small" | "medium" | "large" | "inventory" | "slot";
}

export function EntityIcon({ src, name, size = "medium" }: EntityIconProps) {
  const [failed, setFailed] = useState(false);
  const initial = Array.from(name.trim())[0] ?? "丹";

  return (
    <span className={`entity-icon entity-icon--${size}`} aria-hidden="true">
      <span className="entity-icon__fallback">{initial}</span>
      {src && !failed ? (
        <img
          className="entity-icon__image"
          src={src}
          alt=""
          draggable={false}
          onError={() => setFailed(true)}
        />
      ) : null}
    </span>
  );
}
