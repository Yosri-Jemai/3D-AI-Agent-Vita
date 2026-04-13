package com.unity6.vita.dto;

import com.unity6.vita.entity.Role;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;

@Data
@AllArgsConstructor
@NoArgsConstructor
@Builder
public class ProfileDTO {
    private Long id;
    private String fullName;
    private String email;
    private String password;
    private String profileImageUrl;
    private String numTelephone;
    private Role role;
    private LocalDateTime createdAt;
}
