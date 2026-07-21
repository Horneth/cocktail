import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { useActiveBarId, useAssumeStaples, useVolumePreference } from './useSettings'

afterEach(() => {
  localStorage.clear()
})

describe('useActiveBarId', () => {
  it('reads the stored bar id at mount', () => {
    localStorage.setItem('cocktail.activeBarId', 'bar-A')
    const { result } = renderHook(() => useActiveBarId())
    expect(result.current[0]).toBe('bar-A')
  })

  it('is undefined until a bar is chosen', () => {
    const { result } = renderHook(() => useActiveBarId())
    expect(result.current[0]).toBeUndefined()
  })

  // The bug: switching bars on one screen left other screens (Home, Browse,
  // Detail) showing the old bar, because each instance kept its own useState
  // copy. Every instance must now observe the same value.
  it('propagates a switch to every live instance', () => {
    const a = renderHook(() => useActiveBarId())
    const b = renderHook(() => useActiveBarId())

    act(() => a.result.current[1]('bar-B'))

    expect(a.result.current[0]).toBe('bar-B')
    expect(b.result.current[0]).toBe('bar-B')
    expect(localStorage.getItem('cocktail.activeBarId')).toBe('bar-B')

    // ...and switching from the second instance is seen by the first.
    act(() => b.result.current[1]('bar-C'))
    expect(a.result.current[0]).toBe('bar-C')
    expect(b.result.current[0]).toBe('bar-C')
  })
})

describe('useAssumeStaples', () => {
  it('defaults on and stays in sync across instances', () => {
    const a = renderHook(() => useAssumeStaples())
    const b = renderHook(() => useAssumeStaples())
    expect(a.result.current[0]).toBe(true)

    act(() => a.result.current[1](false))
    expect(a.result.current[0]).toBe(false)
    expect(b.result.current[0]).toBe(false)
  })
})

describe('useVolumePreference', () => {
  it('defaults to oz and toggles across instances', () => {
    const a = renderHook(() => useVolumePreference())
    const b = renderHook(() => useVolumePreference())
    expect(a.result.current[0]).toBe('oz')

    act(() => a.result.current[1]())
    expect(a.result.current[0]).toBe('ml')
    expect(b.result.current[0]).toBe('ml')
  })
})
