import { useEffect, useState } from 'react';
import { Box, Skeleton } from '@mui/material';

export default function AuthLottiePlayer({
    animationPath = '/lottie/login.json',
    height = 500,
}) {
    const [LottieComponent, setLottieComponent] = useState(null);
    const [animationData, setAnimationData] = useState(null);

    useEffect(() => {
        let mounted = true;
        const abortController = new AbortController();

        const load = async () => {
            try {
                const [lottieModule, response] = await Promise.all([
                    import('lottie-react'),
                    fetch(animationPath, { signal: abortController.signal, cache: 'force-cache' }),
                ]);

                if (!response.ok) {
                    throw new Error(`Failed to fetch animation: ${response.status}`);
                }

                const json = await response.json();
                if (!mounted) return;

                setLottieComponent(() => lottieModule.default);
                setAnimationData(json);
            } catch {
                if (!mounted) return;
                setLottieComponent(null);
                setAnimationData(null);
            }
        };

        load();

        return () => {
            mounted = false;
            abortController.abort();
        };
    }, [animationPath]);

    if (!LottieComponent || !animationData) {
        return <Skeleton variant="rounded" height={height} sx={{ borderRadius: 2 }} />;
    }

    return (
        <Box sx={{ width: '100%', height }}>
            <LottieComponent animationData={animationData} loop style={{ width: '100%', height }} />
        </Box>
    );
}
