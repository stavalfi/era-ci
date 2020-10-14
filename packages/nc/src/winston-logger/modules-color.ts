import chalk from 'chalk'
import randomColor from 'randomcolor'

//
// Fix colors not appearing in non-tty environments
//
chalk.level = 3

const moduleToColor = new Map<string, string>()

export function randomModuleColor(module: string): string {
  const color = moduleToColor.get(module)
  if (color) {
    return chalk.hex(color)(module)
  } else {
    const newColor = randomColor({ luminosity: 'light' })
    moduleToColor.set(module, newColor)
    return chalk.hex(newColor)(module)
  }
}
