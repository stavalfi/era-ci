import { Graph, Node } from './types'

export async function travelGraph<Data, newData>(
  graph: Graph<Data>,
  options: {
    fromLeafs: true
    mapData: (node: Node<Data>, i: number, graph: Graph<Data>) => Promise<newData>
  },
): Promise<Graph<newData>> {
  const visited = new Set<number>()
  const newGraph: Graph<newData> = [] // unsorted!

  async function visit(nodeIndex: number): Promise<void> {
    if (!visited.has(nodeIndex)) {
      visited.add(nodeIndex)
      newGraph.push({ ...graph[nodeIndex], data: await options.mapData(graph[nodeIndex], nodeIndex, graph) })
      await Promise.all(graph[nodeIndex].parentsIndexes.map(visit))
    }
  }

  const leafs = graph.filter(node => node.childrenIndexes.length === 0)
  await Promise.all(leafs.map(node => visit(node.index)))

  return newGraph.sort((a, b) => (a.index < b.index ? -1 : a.index > b.index ? 1 : 0))
}
