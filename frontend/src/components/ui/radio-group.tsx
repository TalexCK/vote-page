import * as React from 'react'
import * as RadioPrimitive from '@radix-ui/react-radio-group'
import { cn } from '@/lib/utils'

export const RadioGroup = React.forwardRef<React.ElementRef<typeof RadioPrimitive.Root>, React.ComponentPropsWithoutRef<typeof RadioPrimitive.Root>>(({ className, ...props }, ref) => <RadioPrimitive.Root ref={ref} className={cn('grid gap-2', className)} {...props} />)
RadioGroup.displayName = 'RadioGroup'
export const RadioGroupItem = React.forwardRef<React.ElementRef<typeof RadioPrimitive.Item>, React.ComponentPropsWithoutRef<typeof RadioPrimitive.Item>>(({ className, ...props }, ref) => (
  <RadioPrimitive.Item ref={ref} className={cn('size-5 shrink-0 rounded-full border border-input focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 data-[state=checked]:border-primary', className)} {...props}>
    <RadioPrimitive.Indicator className="flex items-center justify-center"><span className="size-2.5 rounded-full bg-primary" /></RadioPrimitive.Indicator>
  </RadioPrimitive.Item>
))
RadioGroupItem.displayName = 'RadioGroupItem'
