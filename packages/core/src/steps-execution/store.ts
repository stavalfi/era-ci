import { applyMiddleware, createStore, Reducer, Store } from 'redux'
import { combineEpics, createEpicMiddleware, Epic } from 'redux-observable'
import { Actions } from './actions'
import { State } from './state'

export function createReduxStore(options: {
  epics: Epic<Actions, Actions, State>[]
  reducer: Reducer<State, Actions>
}): Store<State, Actions> {
  const epicMiddleware = createEpicMiddleware<Actions, Actions, State>()

  const store = createStore(options.reducer, applyMiddleware(epicMiddleware))

  const rootEpic = combineEpics(...options.epics)

  epicMiddleware.run(rootEpic)

  return store
}
