/**
 * @template [Type = any]
 * @typedef {{
 *   value?: Type
 *   parent?: Node
 *   children?: Node[]
 *   signals?: Signal[]
 *   context?: Record<string | symbol, any>
 *   cleanups?: Cleanup[]
 *   fn?: (value: Type) =>  Type
 * }} Node
 */
/**
 * @typedef {() => void} Cleanup
 */
/**
 * @template [Type = any]
 * @typedef {{ value: Type }} Signal
 */
/**
 * @template [Type = any]
 * @typedef {{ readonly value: Type }} ReadonlySignal
 */
/**
 * @template Type
 * @typedef {Type extends Resolvable ? Type["value"] : Type} Resolved
 */
/**
 * @typedef {{ value: any }} Resolvable
 */
/**
 * @type {WeakMap<Signal, Set<Node>>}
 */
const effectMap = new WeakMap()
/**
 * @type {Set<Node>}
 */
const effectQueue = new Set()
const errorKey = Symbol("Error")
let isRunning = false
/**
 * @type {Node | undefined}
 */
let currentNode

export function getNode() {
  if (currentNode === undefined) {
    throw new Error("getNode() called without parent.")
  }
  return currentNode
}

/**
 * @template Type
 * @param {(cleanup: Cleanup) => Type} fn
 */
export function root(fn) {
  /** @type {Node} */
  const node = Object.create(null),
    prevNode = currentNode
  if (currentNode) {
    node.parent = currentNode
    if (currentNode.children === undefined) {
      currentNode.children = [node]
    } else {
      currentNode.children.push(node)
    }
  }
  try {
    currentNode = node
    return fn(() => clean(node, true))
  } catch (error) {
    handleError(error)
  } finally {
    currentNode = prevNode
  }
}

/**
 * @template Type
 * @param {string | symbol} key
 * @param {Type} value
 */
export function provide(key, value) {
  if (currentNode === undefined) {
    throw new Error("provide(key, value) called without parent.")
  }
  if (currentNode.context === undefined) {
    currentNode.context = {}
  }
  currentNode.context[key] = value
}

/**
 * @template Type
 * @overload
 * @param {string | symbol} key
 * @returns {Type | undefined}
 */
/**
 * @template Type
 * @overload
 * @param {string | symbol} key
 * @param {Type} value
 * @returns {Type}
 */
/**
 * @template Type
 * @param {string | symbol} key
 * @param {Type} [value]
 */
export function inject(key, value) {
  return lookup(currentNode, key) ?? value
}

/**
 * @param {Node | undefined | null} node
 * @param {string | symbol} key
 */
function lookup(node, key) {
  return node == null
    ? undefined
    : node.context !== undefined && key in node.context
    ? node.context[key]
    : lookup(node.parent, key)
}

/**
 * @template Type
 * @overload
 * @returns {Signal<Type | undefined>}
 */
/**
 * @template Type
 * @overload
 * @param {Type} value
 * @returns {Signal<Type>}
 */
/**
 * @template Type
 * @param {Type} [value]
 * @returns {Signal<Type | undefined>}
 */
export function signal(value) {
  return {
    get value() {
      sub(this)
      return value
    },
    set value(newValue) {
      if (value !== newValue) {
        value = newValue
        pub(this)
      }
    },
  }
}

/**
 * @template Type
 * @overload
 * @param {() => Type} fn
 * @returns {ReadonlySignal<Type | undefined>}
 */
/**
 * @template Type
 * @overload
 * @param {() => Type} fn
 * @param {Type} value
 * @returns {ReadonlySignal<Type>}
 */
/**
 * @template Type
 * @param {() => Type} fn
 * @param {Type} [value]
 * @returns {ReadonlySignal<Type | undefined>}
 */
export function memo(fn, value) {
  const data = signal(value)
  effect(() => {
    data.value = fn()
  })
  return {
    get value() {
      return data.value
    },
  }
}

/**
 * @template Type
 * @overload
 * @param {() => Type} fn
 * @returns {ReadonlySignal<Type | undefined>}
 */
/**
 * @template Type
 * @overload
 * @param {() => Type} fn
 * @param {Type} value
 * @returns {ReadonlySignal<Type>}
 */
/**
 * @template Type
 * @overload
 * @param {() => Type} fn
 * @param {Type} value
 * @param {number} timeout
 * @returns {ReadonlySignal<Type>}
 */
/**
 * @template Type
 * @param {() => Type} fn
 * @param {Type} [value]
 * @param {number} [timeout]
 * @returns {ReadonlySignal<Type | undefined>}
 */
export function deferred(fn, value, timeout) {
  const data = signal(value)
  effect((handle) => {
    const value = fn()
    cancelIdleCallback(handle)
    return requestIdleCallback(() => data.value = value, {
      timeout,
    })
  })
  return {
    get value() {
      return data.value
    },
  }
}

/**
 * @template Type
 * @param {() => any} fn
 * @param {(value: Type) => Type} cb
 * @returns {(value: Type) => Type}
 */
export function on(fn, cb) {
  return function (value) {
    fn()
    return untrack(() => cb(value))
  }
}

/**
 * @template Type
 * @param {(value: Type) => Type} fn
 * @param {Signal[]} signals
 * @returns {(value: Type) => Type}
 */
export function deps(fn, ...signals) {
  return function (value) {
    signals.forEach((signal) => signal.value)
    return untrack(() => fn(value))
  }
}

/**
 * @template Type
 * @param {() => Type} fn
 * @returns {Type}
 */
export function untrack(fn) {
  const node = currentNode
  currentNode = undefined
  const result = fn()
  currentNode = node
  return result
}

/**
 * @template Type
 * @overload
 * @param {(value: Type | undefined) => Type} fn
 * @returns {void}
 */
/**
 * @template Type
 * @overload
 * @param {(value: Type) => Type} fn
 * @param {Type} value
 * @returns {void}
 */
export function effect(fn, value) {
  /** @type {Node} */
  const node = Object.create(null)
  node.fn = fn
  if (value !== undefined) {
    node.value = value
  }
  if (currentNode) {
    node.parent = currentNode
    if (currentNode.children === undefined) {
      currentNode.children = [node]
    } else {
      currentNode.children.push(node)
    }
  }
  if (isRunning) {
    effectQueue.add(node)
  } else {
    queueMicrotask(() => update(node))
  }
}

/**
 * @param {Node} node
 * @param {boolean} dispose
 */
function clean(node, dispose) {
  if (node.signals?.length) {
    let signal = node.signals.pop()
    while (signal) {
      const effects = effectMap.get(signal)
      if (effects) {
        effects.delete(node)
        if (dispose) {
          effectMap.delete(signal)
        }
      }
      signal = node.signals.pop()
    }
  }
  if (node.children?.length) {
    let childNode = node.children.pop()
    while (childNode) {
      clean(childNode, childNode.fn ? true : dispose)
      childNode = node.children.pop()
    }
  }
  if (node.cleanups?.length) {
    let cleanup = node.cleanups.pop()
    while (cleanup) {
      cleanup()
      cleanup = node.cleanups.pop()
    }
  }
  delete node.context
  if (dispose) {
    delete node.value
    delete node.signals
    delete node.parent
    delete node.children
    delete node.fn
    delete node.cleanups
  }
}

/**
 * @param {Node} node
 */
function update(node) {
  clean(node, false)
  if (node.fn == null) {
    return
  }
  const prevNode = currentNode
  try {
    currentNode = node
    node.value = node.fn(node.value)
  } catch (error) {
    handleError(error)
  } finally {
    currentNode = prevNode
  }
}

/**
 * @param {Cleanup} fn
 */
export function cleanup(fn) {
  if (currentNode === undefined) {
    throw new Error("cleanup(fn) called without parent.")
  }
  if (currentNode.cleanups) {
    currentNode.cleanups.push(fn)
  } else {
    currentNode.cleanups = [fn]
  }
}

/**
 * @param {(error: any) => void} fn
 */
export function catchError(fn) {
  if (currentNode === undefined) {
    throw new Error(`catchError(fn): called without parent.`)
  }
  if (currentNode.context === undefined) {
    currentNode.context = {}
  }
  if (currentNode.context[errorKey]) {
    currentNode.context[errorKey].push(fn)
  } else {
    currentNode.context[errorKey] = [fn]
  }
}

/**
 * @param {any} error
 */
function handleError(error) {
  const errorFns = lookup(currentNode, errorKey)
  if (!errorFns) {
    return reportError(error)
  }
  for (const errorFn of errorFns) {
    errorFn(error)
  }
}

/**
 * @param {Signal} signal
 */
export function sub(signal) {
  if (currentNode?.fn) {
    let effects = effectMap.get(signal)
    if (effects === undefined) {
      effectMap.set(signal, effects = new Set())
    }
    effects.add(currentNode)
    if (currentNode.signals === undefined) {
      currentNode.signals = [signal]
    } else {
      currentNode.signals.push(signal)
    }
  }
}

/**
 * @param {Signal} signal
 */
export function pub(signal) {
  effectMap.get(signal)?.forEach(queue)
}

/**
 * @param {Node} node
 */
function queue(node) {
  effectQueue.add(node)
  if (isRunning === false) {
    isRunning = true
    queueMicrotask(batch)
  }
}

function batch() {
  if (isRunning) {
    for (const effect of effectQueue) {
      update(effect)
    }
    effectQueue.clear()
    isRunning = false
  }
}

/**
 * @param {any} data
 * @returns {data is { value: any }}
 */
export function resolvable(data) {
  return data && typeof data === "object" && Reflect.has(data, "value")
}

/**
 * @template Type
 * @param {Type} data
 * @returns {Resolved<Type>}
 */
export function resolve(data) {
  return resolvable(data) ? data.value : data
}
