import { useState, useEffect, memo, useMemo, useRef } from 'react';
import {
    Box, Card, CardContent, Typography, Chip, LinearProgress,
    IconButton, Tooltip,
} from '@mui/material';
import { Memory, Speed, Visibility, Close, Public } from '@mui/icons-material';
import { getMemoryUsage } from '../utils/performanceUtils';

const I18N = {
    en: {
        tooltip: 'Performance Monitor',
        title: 'Performance Monitor',
        memoryUsage: 'Memory Usage',
        frameTime: 'Frame Time',
        avgLongTask: 'Avg long-task: {value}ms',
        mainThreadBusy: 'Main thread busy',
        mainThreadHealthy: 'Main thread healthy',
        intlReadiness: 'International readiness {score}/{max}',
        localeSummary: 'Locale {locale} | Timezone {timeZone} | Numbering {numberingSystem}',
        heapLimit: '(heap limit {limit}MB)',
    },
    hi: {
        tooltip: 'परफॉर्मेंस मॉनिटर',
        title: 'परफॉर्मेंस मॉनिटर',
        memoryUsage: 'मेमोरी उपयोग',
        frameTime: 'फ्रेम समय',
        avgLongTask: 'औसत लंबा टास्क: {value}ms',
        mainThreadBusy: 'मुख्य थ्रेड व्यस्त',
        mainThreadHealthy: 'मुख्य थ्रेड स्वस्थ',
        intlReadiness: 'अंतरराष्ट्रीय तैयारी {score}/{max}',
        localeSummary: 'लोकेल {locale} | टाइमज़ोन {timeZone} | नंबरिंग {numberingSystem}',
        heapLimit: '(हीप सीमा {limit}MB)',
    },
};

const interpolate = (template, vars = {}) =>
    String(template || '').replace(/\{(\w+)\}/g, (_, key) =>
        Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : `{${key}}`
    );

const PerformanceMonitor = memo(() => {
    const [isVisible, setIsVisible] = useState(false);
    const [memoryUsage, setMemoryUsage] = useState(null);
    const [frameTime, setFrameTime] = useState(0);
    const [isMonitoring, setIsMonitoring] = useState(false);
    const [longTaskMs, setLongTaskMs] = useState(0);
    const rafRef = useRef(null);
    const frameHistoryRef = useRef([]);

    const locale = useMemo(() => {
        const fromIntl = Intl.DateTimeFormat().resolvedOptions().locale;
        return fromIntl || navigator.language || 'en-US';
    }, []);

    const lang = useMemo(() => String(locale).split('-')[0].toLowerCase(), [locale]);
    const dictionary = I18N[lang] || I18N.en;

    const numberFormatter = useMemo(() => new Intl.NumberFormat(locale), [locale]);
    const percentFormatter = useMemo(
        () => new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }),
        [locale]
    );

    const t = (key, vars) => interpolate(dictionary[key] || I18N.en[key] || key, vars);

    const intlProfile = useMemo(() => {
        const options = Intl.DateTimeFormat().resolvedOptions();
        const checks = [
            typeof Intl !== 'undefined',
            typeof Intl.RelativeTimeFormat !== 'undefined',
            typeof Intl.ListFormat !== 'undefined',
            typeof Intl.NumberFormat !== 'undefined',
        ];
        const score = checks.filter(Boolean).length;
        return {
            locale: options.locale || 'en-US',
            timeZone: options.timeZone || 'UTC',
            numberingSystem: options.numberingSystem || 'latn',
            score,
            maxScore: checks.length,
        };
    }, []);

    useEffect(() => {
        if (!isMonitoring) return;

        const interval = setInterval(() => {
            const memory = getMemoryUsage();
            if (memory) setMemoryUsage(memory);

            if (frameHistoryRef.current.length) {
                const avg = frameHistoryRef.current.reduce((a, b) => a + b, 0) / frameHistoryRef.current.length;
                setFrameTime(Math.round(avg));
            }
        }, 2500);

        let last = performance.now();
        const tick = (now) => {
            const delta = now - last;
            last = now;

            frameHistoryRef.current.push(delta);
            if (frameHistoryRef.current.length > 30) {
                frameHistoryRef.current.shift();
            }
            rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);

        let observer;
        if (typeof PerformanceObserver !== 'undefined') {
            observer = new PerformanceObserver((entryList) => {
                const entries = entryList.getEntries();
                if (!entries.length) return;
                const avgLongTask = entries.reduce((sum, e) => sum + e.duration, 0) / entries.length;
                setLongTaskMs(Math.round(avgLongTask));
            });
            try {
                observer.observe({ entryTypes: ['longtask'] });
            } catch {
                // ignore unsupported browsers
            }
        }

        return () => {
            clearInterval(interval);
            if (rafRef.current) cancelAnimationFrame(rafRef.current);
            frameHistoryRef.current = [];
            if (observer) observer.disconnect();
        };
    }, [isMonitoring]);

    const toggleVisibility = () => {
        setIsVisible(!isVisible);
        if (!isVisible) setIsMonitoring(true);
    };

    const getMemoryColor = (usage) => {
        if (!usage) return 'default';
        const denominator = Math.max(usage.total || usage.limit || 1, 1);
        const pct = (usage.used / denominator) * 100;
        return pct > 80 ? 'error' : pct > 60 ? 'warning' : 'success';
    };

    const getMemoryPercentage = (usage) => {
        if (!usage) return 0;
        const denominator = Math.max(usage.total || usage.limit || 1, 1);
        return Math.round((usage.used / denominator) * 100);
    };

    if (!isVisible) {
        return (
            <Tooltip title={t('tooltip')}>
                <IconButton
                    className="performance-monitor-fab"
                    onClick={toggleVisibility}
                    sx={{
                        position: 'fixed', bottom: 16, right: 16, zIndex: 1400,
                        backgroundColor: 'primary.main', color: 'white',
                        '&:hover': { backgroundColor: 'primary.dark' },
                    }}
                >
                    <Speed />
                </IconButton>
            </Tooltip>
        );
    }

    return (
        <Card
            className="performance-monitor-panel"
            sx={{
                position: 'fixed', bottom: 16, right: 16, zIndex: 1400,
                minWidth: 300, maxWidth: 400, boxShadow: 3,
            }}
        >
            <CardContent sx={{ pb: 1 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                    <Typography variant="h6" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Speed sx={{ fontSize: 20 }} />
                        {t('title')}
                    </Typography>
                    <IconButton size="small" onClick={toggleVisibility}>
                        <Close />
                    </IconButton>
                </Box>

                {memoryUsage && (
                    <Box sx={{ mb: 2 }}>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                            <Typography variant="body2" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                <Memory sx={{ fontSize: 16 }} />
                                {t('memoryUsage')}
                            </Typography>
                            <Chip
                                label={percentFormatter.format(getMemoryPercentage(memoryUsage) / 100)}
                                color={getMemoryColor(memoryUsage)}
                                size="small"
                            />
                        </Box>
                        <LinearProgress
                            variant="determinate"
                            value={getMemoryPercentage(memoryUsage)}
                            color={getMemoryColor(memoryUsage)}
                            sx={{ mb: 1 }}
                        />
                        <Typography variant="caption" color="text.secondary">
                            {numberFormatter.format(memoryUsage.used)}MB / {numberFormatter.format(memoryUsage.total || memoryUsage.limit)}MB
                            {memoryUsage.limit ? ` ${t('heapLimit', { limit: numberFormatter.format(memoryUsage.limit) })}` : ''}
                        </Typography>
                    </Box>
                )}

                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Typography variant="body2" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Visibility sx={{ fontSize: 16 }} />
                        {t('frameTime')}
                    </Typography>
                    <Chip
                        label={`${numberFormatter.format(frameTime)}ms`}
                        color={frameTime > 32 ? 'error' : frameTime > 20 ? 'warning' : 'success'}
                        size="small"
                    />
                </Box>

                <Box sx={{ mt: 1.2, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Typography variant="caption" color="text.secondary">
                        {t('avgLongTask', { value: numberFormatter.format(longTaskMs) })}
                    </Typography>
                    <Chip
                        size="small"
                        label={longTaskMs > 50 ? t('mainThreadBusy') : t('mainThreadHealthy')}
                        color={longTaskMs > 50 ? 'warning' : 'success'}
                    />
                </Box>

                <Box sx={{ mt: 1.5, p: 1, borderRadius: 1, backgroundColor: 'action.hover' }}>
                    <Typography variant="caption" sx={{ display: 'flex', alignItems: 'center', gap: 0.5, fontWeight: 600 }}>
                        <Public sx={{ fontSize: 14 }} />
                        {t('intlReadiness', {
                            score: numberFormatter.format(intlProfile.score),
                            max: numberFormatter.format(intlProfile.maxScore),
                        })}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                        {t('localeSummary', {
                            locale: intlProfile.locale,
                            timeZone: intlProfile.timeZone,
                            numberingSystem: intlProfile.numberingSystem,
                        })}
                    </Typography>
                </Box>
            </CardContent>
        </Card>
    );
});

PerformanceMonitor.displayName = 'PerformanceMonitor';

export default PerformanceMonitor;
