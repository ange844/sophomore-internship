// Heroicons (https://heroicons.com, v2.2.0, MIT licence) used by the chat pages.
// Path data is copied unchanged from the official package: 24x24 "outline" icons
// (1.5px stroke) and the 24x24 "solid" stop icon. Chat.icon(name) returns an <svg>
// that inherits the colour of its button or text, and is sized with CSS (.icon).
(() => {
  const NS = "http://www.w3.org/2000/svg";

  const OUTLINE = {
    "paper-clip": "m18.375 12.739-7.693 7.693a4.5 4.5 0 0 1-6.364-6.364l10.94-10.94A3 3 0 1 1 19.5 7.372L8.552 18.32m.009-.01-.01.01m5.699-9.941-7.81 7.81a1.5 1.5 0 0 0 2.112 2.13",
    "microphone": "M12 18.75a6 6 0 0 0 6-6v-1.5m-6 7.5a6 6 0 0 1-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 0 1-3-3V4.5a3 3 0 1 1 6 0v8.25a3 3 0 0 1-3 3Z",
    "x-mark": "M6 18 18 6M6 6l12 12",
    "document": "M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z",
    "photo": "m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5H3.75A1.5 1.5 0 0 0 2.25 6v12a1.5 1.5 0 0 0 1.5 1.5Zm10.5-11.25h.008v.008h-.008V8.25Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z",
  };
  const SOLID = {
    "stop": "M4.5 7.5a3 3 0 0 1 3-3h9a3 3 0 0 1 3 3v9a3 3 0 0 1-3 3h-9a3 3 0 0 1-3-3v-9Z",
  };

  function icon(name, extraClass = "") {
    const outline = name in OUTLINE;
    const d = outline ? OUTLINE[name] : SOLID[name];
    if (!d) throw new Error(`Unknown icon: ${name}`);
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("class", ("icon " + extraClass).trim());
    const path = document.createElementNS(NS, "path");
    path.setAttribute("d", d);
    if (outline) {
      svg.setAttribute("fill", "none");
      svg.setAttribute("stroke", "currentColor");
      svg.setAttribute("stroke-width", "1.5");
      path.setAttribute("stroke-linecap", "round");
      path.setAttribute("stroke-linejoin", "round");
    } else {
      svg.setAttribute("fill", "currentColor");
      path.setAttribute("fill-rule", "evenodd");
      path.setAttribute("clip-rule", "evenodd");
    }
    svg.append(path);
    return svg;
  }

  function setIcon(element, name) {
    element.replaceChildren(icon(name));
  }

  window.Chat.icon = icon;
  window.Chat.setIcon = setIcon;
})();
