package com.unity6.vita.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import java.time.LocalDateTime;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class SessionDTO {
    private Long id;
    private Long profileId;
    private String sessionUuid;
    private String mode;
    private LocalDateTime startedAt;
    private LocalDateTime endedAt;
}