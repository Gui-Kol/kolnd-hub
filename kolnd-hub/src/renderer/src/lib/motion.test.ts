import { describe, expect, it } from 'vitest'
import { entranceProps, exitProps, fadeOnlyTransition, useReducedMotion } from './motion'

describe('motion — helpers de movimento acessível', () => {
  it('com reduce ativo vira fade puro de 200 ms, sem transforms', () => {
    expect(entranceProps(true, { y: 20, x: 10, scale: 0.9 })).toEqual({
      initial: { opacity: 0 },
      animate: { opacity: 1 },
      transition: fadeOnlyTransition
    })
    expect(exitProps(true, { y: 10, x: 10, scale: 0.9 })).toEqual({ opacity: 0 })
  })

  it('com reduce desligado preserva deslocamentos e transição original', () => {
    const transition = { duration: 0.4 }
    expect(entranceProps(false, { y: 20, x: 10, scale: 0.9 }, transition)).toEqual({
      initial: { opacity: 0, y: 20, x: 10, scale: 0.9 },
      animate: { opacity: 1, y: 0, x: 0, scale: 1 },
      transition
    })
    expect(exitProps(false, { y: 10, x: 5, scale: 0.8 })).toEqual({
      opacity: 0,
      y: 10,
      x: 5,
      scale: 0.8
    })
  })

  it('sem offsets informados devolve só opacidade', () => {
    expect(entranceProps(false)).toEqual({
      initial: { opacity: 0 },
      animate: { opacity: 1 },
      transition: undefined
    })
    expect(exitProps(false)).toEqual({ opacity: 0 })
  })

  it('null (preferência ainda não resolvida) conta como reduce desligado', () => {
    expect(entranceProps(null, { y: 5 }).initial).toEqual({ opacity: 0, y: 5 })
    expect(exitProps(null, { y: 5 })).toEqual({ opacity: 0, y: 5 })
  })

  it('reexporta o hook do framer-motion e a transição de fade', () => {
    expect(typeof useReducedMotion).toBe('function')
    expect(fadeOnlyTransition).toEqual({ duration: 0.2, ease: 'easeOut' })
  })
})
