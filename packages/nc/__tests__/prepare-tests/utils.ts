export function isDeepSubsetOf(
  fullObj: unknown,
  subset: unknown,
): { result: true } | { result: false; problem: string; fullObj: unknown; subset: unknown } {
  if (typeof fullObj !== typeof subset) {
    return {
      result: false,
      fullObj,
      subset,
      problem: 'not equal',
    }
  }
  switch (typeof fullObj) {
    case 'symbol':
    case 'string':
    case 'bigint':
    case 'number':
    case 'boolean':
    case 'undefined':
    case 'function':
      if (fullObj !== subset) {
        return {
          result: false,
          fullObj,
          subset,
          problem: 'not equal',
        }
      } else {
        return {
          result: true,
        }
      }
    case 'object': {
      if (Array.isArray(fullObj)) {
        if (!Array.isArray(subset)) {
          return {
            result: false,
            fullObj,
            subset,
            problem: 'subset is not array as well',
          }
        } else {
          for (const element of subset) {
            if (fullObj.every(e => !isDeepSubsetOf(e, element).result)) {
              return {
                result: false,
                fullObj,
                subset: element,
                problem: 'subset is element of array that can not be found in fullObj array',
              }
            }
          }
          return {
            result: true,
          }
        }
      } else {
        if ((fullObj === null && subset !== null) || (fullObj !== null && subset === null)) {
          return {
            result: false,
            fullObj,
            subset,
            problem: 'not equal',
          }
        } else {
          if (fullObj === null && subset === null) {
            return {
              result: true,
            }
          }
          if (typeof subset !== 'object') {
            throw new Error(`we can't be here because we already ensured that both has the same type`)
          }
          for (const [key, value] of Object.entries(subset || {})) {
            // @ts-ignore
            const fullObjValue: unknown = (fullObj || {})[key]
            const result = isDeepSubsetOf(fullObjValue, value)
            if (!result.result) {
              return result
            }
          }
          return {
            result: true,
          }
        }
      }
    }
  }
}

export function isDeepSubsetOfOrPrint(fullObj: unknown, subset: unknown): boolean {
  const result = isDeepSubsetOf(fullObj, subset)

  if (result.result) {
    return true
  } else {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(result, null, 2))
    return false
  }
}
