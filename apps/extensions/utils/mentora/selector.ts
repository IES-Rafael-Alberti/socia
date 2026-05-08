/**
 * Generates a unique CSS selector for an element
 * Useful for LLMs to understand which element was interacted with
 */

export function getUniqueSelector(element: Element): string {
  // If element has a unique ID, use it
  if (element.id) {
    return `#${CSS.escape(element.id)}`;
  }

  // Try to build a selector path
  const path: string[] = [];
  let current: Element | null = element;

  while (current && current !== document.body && current !== document.documentElement) {
    let selector = current.tagName.toLowerCase();

    // Add ID if available
    if (current.id) {
      selector = `#${CSS.escape(current.id)}`;
      path.unshift(selector);
      break;
    }

    // Add classes if they help identify
    if (current.className && typeof current.className === 'string') {
      const classes = current.className
        .split(/\s+/)
        .filter((c) => c && !c.startsWith('_') && !/^[a-z0-9]{6,}$/i.test(c)) // Filter out generated classes
        .slice(0, 2); // Limit to 2 classes
      if (classes.length > 0) {
        selector += '.' + classes.map((c) => CSS.escape(c)).join('.');
      }
    }

    // Add nth-child if needed for uniqueness
    const here: Element = current;
    const parent: Element | null = here.parentElement;
    if (parent) {
      const siblings: Element[] = Array.from(parent.children).filter(
        (child: Element) => child.tagName === here.tagName,
      );
      if (siblings.length > 1) {
        const index = siblings.indexOf(here) + 1;
        selector += `:nth-child(${index})`;
      }
    }

    // Add useful attributes
    const role = current.getAttribute('role');
    if (role) {
      selector += `[role="${role}"]`;
    }

    const type = current.getAttribute('type');
    if (type && current.tagName.toLowerCase() === 'input') {
      selector += `[type="${type}"]`;
    }

    const name = current.getAttribute('name');
    if (name) {
      selector += `[name="${CSS.escape(name)}"]`;
    }

    path.unshift(selector);
    current = parent;

    // Limit path depth
    if (path.length >= 4) break;
  }

  const fullSelector = path.join(' > ');

  // Verify selector uniqueness
  try {
    const matches = document.querySelectorAll(fullSelector);
    if (matches.length === 1) {
      return fullSelector;
    }
  } catch {
    // Invalid selector, fall through
  }

  // Fallback: use data attributes or aria labels
  const dataTestId = element.getAttribute('data-testid');
  if (dataTestId) {
    return `[data-testid="${CSS.escape(dataTestId)}"]`;
  }

  const ariaLabel = element.getAttribute('aria-label');
  if (ariaLabel) {
    return `[aria-label="${CSS.escape(ariaLabel)}"]`;
  }

  // Last resort: return the path we built
  return fullSelector || element.tagName.toLowerCase();
}

/**
 * Gets element text content (truncated)
 */
export function getElementText(element: Element, maxLength: number = 50): string {
  // For inputs, return placeholder or value hint
  if (element instanceof HTMLInputElement) {
    return element.placeholder || `[${element.type} input]`;
  }

  if (element instanceof HTMLTextAreaElement) {
    return element.placeholder || '[textarea]';
  }

  if (element instanceof HTMLSelectElement) {
    const selected = element.options[element.selectedIndex];
    return selected?.text || '[select]';
  }

  // Get visible text
  const text = element.textContent?.trim().replace(/\s+/g, ' ') || '';

  if (text.length > maxLength) {
    return text.substring(0, maxLength) + '...';
  }

  return text;
}

/**
 * Gets a human-readable description of an element
 */
export function getElementDescription(element: Element): string {
  const tagName = element.tagName.toLowerCase();
  const text = getElementText(element);
  const ariaLabel = element.getAttribute('aria-label');
  const title = element.getAttribute('title');
  const alt = element.getAttribute('alt');

  // Use aria-label if available
  if (ariaLabel) {
    return `'${ariaLabel}' ${tagName}`;
  }

  // Use title
  if (title) {
    return `'${title}' ${tagName}`;
  }

  // Use alt for images
  if (alt) {
    return `'${alt}' image`;
  }

  // Use text content
  if (text) {
    return `'${text}' ${tagName}`;
  }

  // Describe by type
  if (element instanceof HTMLInputElement) {
    const label = document.querySelector(`label[for="${element.id}"]`);
    if (label) {
      return `'${getElementText(label)}' input`;
    }
    return `${element.type} input${element.name ? ` (${element.name})` : ''}`;
  }

  if (element instanceof HTMLButtonElement) {
    return 'button';
  }

  if (element instanceof HTMLAnchorElement) {
    return `link${element.href ? ` to ${new URL(element.href).hostname}` : ''}`;
  }

  // Generic fallback
  const classes = element.className && typeof element.className === 'string'
    ? element.className.split(/\s+/).slice(0, 2).join('.')
    : '';

  return classes ? `${tagName}.${classes}` : tagName;
}
