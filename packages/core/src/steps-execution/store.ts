import { applyMiddleware, createStore, Reducer, Store } from 'redux'
import { combineEpics, createEpicMiddleware, Epic } from 'redux-observable'
import { Actions } from './actions'
import { State } from './state'

export function createReduxStore(options: {
  reducer: Reducer<State, Actions>
  epics: Epic<Actions, Actions, State>[]
}): Store<State, Actions> {
  const rootEpic = combineEpics(...options.epics)

  const epicMiddleware = createEpicMiddleware<Actions, Actions, State>()

  const store = createStore(options.reducer, applyMiddleware(epicMiddleware))

  epicMiddleware.run(rootEpic)

  return store
}
