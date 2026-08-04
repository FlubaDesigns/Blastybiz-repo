/**
 * Blasty Bubble System
 * Loads one authoritative SVG into every message avatar.
 */
class BlastyBubbleSystem {
  constructor(options = {}) {
    this.svgUrl = options.svgUrl || './blasty-master.svg';
    this.root = options.root || document;
    this.svgText = null;
  }

  async init() {
    const response = await fetch(this.svgUrl, { cache: 'force-cache' });
    if (!response.ok) throw new Error(`Unable to load Blasty SVG: ${response.status}`);
    this.svgText = await response.text();

    const avatars = [...this.root.querySelectorAll('.blasty-avatar')];
    avatars.forEach((avatar, index) => {
      avatar.innerHTML = this._uniqueSvg(this.svgText, `blasty-${index + 1}`);
    });

    this.root.querySelectorAll('.blasty-message[data-auto-talk="true"]').forEach(message => {
      this.talk(message, Number(message.dataset.talkMs || 1700));
    });
  }

  setState(message, state) {
    if (!message) return;
    message.dataset.state = state;
  }

  talk(message, duration = 1600) {
    if (!message) return;
    message.dataset.talking = 'true';
    window.setTimeout(() => {
      message.dataset.talking = 'false';
    }, duration);
  }

  /**
   * Duplicate SVG IDs must be unique because the same mascot appears beside
   * every bubble. This rewrites IDs and all local url()/href references.
   */
  _uniqueSvg(svgText, prefix) {
    const ids = [...svgText.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
    let result = svgText;
    ids.forEach(id => {
      const safe = `${prefix}-${id}`;
      result = result
        .replaceAll(`id="${id}"`, `id="${safe}"`)
        .replaceAll(`url(#${id})`, `url(#${safe})`)
        .replaceAll(`href="#${id}"`, `href="#${safe}"`)
        .replaceAll(`xlink:href="#${id}"`, `xlink:href="#${safe}"`);
    });

    /* Preserve class-based styling after IDs are made unique. */
    result = result
      .replace(/id="[^"]+-blasty-rocket"/, match => `${match} class="blasty-rocket-layer"`)
      .replace(/id="[^"]+-blasty-body"/, match => `${match} class="blasty-body-layer"`);
    return result;
  }
}

window.BlastyBubbleSystem = BlastyBubbleSystem;
