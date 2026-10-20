// EduSpace design-system components. Import from '@/components/ui'. Catalogue: docs/ui.md.
export { cn } from './cn';
export { TONE_FILL, TONE_TINT, SERIES_ORDER, type FillTone, type Tone } from './tone';
export { Icon, ICONS, isIconName, renderIcon, type IconInput, type IconName, type IconProps } from './icon';
export {
  ActionTile, Button, IconButton, buttonClasses,
  type ActionTileProps, type ButtonProps, type ButtonSize, type ButtonVariant, type IconButtonProps,
} from './button';
export { Badge, StatusBadge, Tag, statusLabel, type BadgeProps, type StatusBadgeProps, type TagProps } from './badge';
export { Delta, formatDelta, type DeltaProps } from './delta';
export { StatCard, type StatCardProps } from './stat-card';
export { Progress, SegmentBar, type ProgressProps, type Segment, type SegmentBarProps } from './progress';
export { CriterionRow, ScoreBar, type CriterionRowProps, type CriterionStatus, type ScoreBarProps } from './criterion-row';
export { Breadcrumb, NavItem, type BreadcrumbProps, type Crumb, type NavItemProps } from './navigation';
export {
  Checkbox, Input, Kbd, RadioGroup, SearchField, Select, Switch, Textarea, controlClasses,
  type CheckboxProps, type InputProps, type RadioGroupProps, type RadioOption, type SearchFieldProps, type SelectOption,
  type SelectProps, type SwitchProps,
} from './inputs';
export { Field, FieldError, Label, type FieldControlProps, type FieldProps } from './field';
export {
  Divider, KeyValueList, PageHeader, Panel, PanelGrid,
  type DividerProps, type KeyValueItem, type KeyValueListProps, type PageHeaderProps, type PanelGridProps, type PanelProps,
} from './layout';
export {
  Alert, EmptyState, ErrorState, Timeline, UserChip, errorMessage, initials,
  type AlertProps, type EmptyStateProps, type ErrorStateProps, type TimelineState, type TimelineStep, type UserChipProps,
} from './feedback';
export { LoadingLabel, Skeleton, SkeletonText, type SkeletonProps } from './skeleton';
export { ConfirmDialog, Dialog, Drawer, useConfirm, type ConfirmDialogProps, type ConfirmOptions, type DialogProps, type DrawerProps } from './dialog';
export { TabPanel, Tabs, type TabItem, type TabPanelProps, type TabsProps } from './tabs';
export { ToastProvider, useToast, type ToastApi, type ToastOptions, type ToastTone } from './toast';
export { Tooltip, type TooltipProps } from './tooltip';
export { Popover, type PopoverProps } from './popover';
export { Pagination, pageCount, type PaginationProps } from './pagination';
export {
  DataTable,
  type DataTableColumn, type DataTableProps, type DataTableServerState, type SortDirection, type SortState,
} from './data-table';
