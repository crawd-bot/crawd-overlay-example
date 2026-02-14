'use client'

import dynamic from 'next/dynamic'

const Overlay = dynamic(() => import('@/components/Overlay').then(m => m.Overlay), {
  ssr: false,
})

export default function Page() {
  return <Overlay />
}
